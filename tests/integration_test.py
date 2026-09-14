import hashlib, importlib.util, json, os, tempfile, unittest, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
adapter=load('docs_return',ROOT/'integration/prepare_return.py')

class ReturnTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='docs-integration-');cls.root=Path(cls.temp.name)
        cls.out=cls.root/'return/codex/DOCS_PILOT_TEST'
        cls.result=adapter.prepare(ROOT,cls.out,'DOCS_PILOT_TEST','codex')
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def test_zip_exact_manifest_and_crc(self):
        with zipfile.ZipFile(self.out/'docs-review.zip') as z:
            self.assertIsNone(z.testzip());manifest={line[66:]:line[:64] for line in z.read('MANIFEST.sha256').decode().splitlines()}
            self.assertEqual(set(manifest),set(z.namelist())-{'MANIFEST.sha256'})
            for name,sha in manifest.items():self.assertEqual(hashlib.sha256(z.read(name)).hexdigest(),sha)
    def test_marker_matches_payload(self):
        marker=json.loads((self.out/'RETURN_READY.json').read_text())
        self.assertEqual({r['relativePath'] for r in marker['files']},{p.name for p in self.out.iterdir()}-{'RETURN_READY.json'})
        for r in marker['files']:
            data=(self.out/r['relativePath']).read_bytes();self.assertEqual(len(data),r['byteLength']);self.assertEqual(hashlib.sha256(data).hexdigest(),r['sha256'])
    def test_no_authority_promotion(self):
        with zipfile.ZipFile(self.out/'docs-review.zip') as z:
            result=json.loads(z.read('RESULT.json'));self.assertFalse(result['humanAcceptance']);self.assertFalse(result['transportReviewReady']);self.assertFalse(result['registryMutation']);self.assertEqual(result['handoffBase'],'UNBOUND_BASE')
    def test_collision_rejected(self):
        with self.assertRaises(FileExistsError):adapter.prepare(ROOT,self.out,'DOCS_PILOT_TEST','codex')
    def test_task_traversal_rejected(self):
        with self.assertRaises(ValueError):adapter.prepare(ROOT,self.root/'bad','../task','codex')
    @unittest.skipUnless(os.environ.get('HRR_INTAKE_SOURCE'),'Real intake implementation path not supplied')
    def test_existing_intake_readonly_and_idempotent(self):
        intake=load('existing_intake',Path(os.environ['HRR_INTAKE_SOURCE']))
        intake.ROOT=self.root;intake.RETURN=self.root/'return';intake.INTAKE=self.root/'intake';intake.TESTOUT=self.root/'test-output'
        intake.INTAKE.mkdir();intake.TESTOUT.mkdir()
        intake.self_test()
        first=intake.process('codex','DOCS_PILOT_TEST',self.out,True)
        self.assertEqual(first['state'],'WOULD_INTAKE')
        result=intake.process('codex','DOCS_PILOT_TEST',self.out,False)
        self.assertEqual(result['state'],'INTAKEN')
        again=intake.process('codex','DOCS_PILOT_TEST',self.out,False)
        self.assertEqual(again['state'],'ALREADY_INTAKEN')
        original=(self.out/'docs-review.zip').read_bytes()
        try:
            (self.out/'docs-review.zip').write_bytes(original+b'drift')
            rejected=intake.process('codex','DOCS_PILOT_TEST',self.out,True)
            self.assertEqual(rejected['state'],'REJECTED')
        finally:(self.out/'docs-review.zip').write_bytes(original)

class GovernanceTests(unittest.TestCase):
    def test_required_human_controls(self):
        setup=load('github_setup',ROOT/'scripts/configure-github.py');config=setup.desired(123)
        p=config['branch_protection'];self.assertTrue(p['enforce_admins']);self.assertTrue(p['required_pull_request_reviews']['require_last_push_approval']);self.assertFalse(p['allow_force_pushes'])
        self.assertEqual(config['docs-production']['reviewers'],[])
        self.assertEqual(config['docs-rollback']['reviewers'],[{'type':'User','id':123}])

if __name__=='__main__':unittest.main(verbosity=2)
