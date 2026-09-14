"""Configure a NEW dedicated docs repo using an already authenticated gh CLI.
No tokens on command line. Does not create repos, push code, or enable deployment.
The default mode prints desired settings; --apply makes explicit admin changes.
"""
import argparse, json, re, subprocess, sys

def gh(*args, payload=None):
    command=['gh',*args]
    if payload is not None: command += ['--input','-']
    result=subprocess.run(command,input=None if payload is None else json.dumps(payload),text=True,capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr)
    return json.loads(result.stdout) if result.stdout.strip() else None

def desired(reviewer_id):
    protection={
        'required_status_checks':{'strict':True,'checks':[{'context':'docs-validate','app_id':15368}]},
        'enforce_admins':True,
        'required_pull_request_reviews':{'dismiss_stale_reviews':True,'require_code_owner_reviews':True,'required_approving_review_count':1,'require_last_push_approval':True},
        'restrictions':None,'required_linear_history':True,'allow_force_pushes':False,'allow_deletions':False,'required_conversation_resolution':True,
    }
    return {'branch_protection':protection,
      'docs-production':{'wait_timer':0,'prevent_self_review':False,'reviewers':[],'deployment_branch_policy':{'protected_branches':False,'custom_branch_policies':True}},
      'docs-rollback':{'wait_timer':0,'prevent_self_review':False,'reviewers':[{'type':'User','id':reviewer_id}],'deployment_branch_policy':{'protected_branches':False,'custom_branch_policies':True}},
      'workflow_permissions':{'default_workflow_permissions':'read','can_approve_pull_request_reviews':False}}

def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--reviewer',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',a.repo) or not re.fullmatch(r'[A-Za-z0-9-]+',a.reviewer):p.error('Invalid repo/reviewer')
    user=gh('api',f'users/{a.reviewer}'); config=desired(user['id']);print(json.dumps(config,indent=2))
    if not a.apply:return
    base=f'repos/{a.repo}'
    # Start fail-closed; any partial failure leaves deployment disabled.
    gh('variable','set','DOCS_DEPLOY_ENABLED','--repo',a.repo,'--body','false')
    gh('api','--method','PUT',f'{base}/branches/main/protection',payload=config['branch_protection'])
    gh('api','--method','PUT',f'{base}/actions/permissions/workflow',payload=config['workflow_permissions'])
    for name in ['docs-production','docs-rollback']:
        gh('api','--method','PUT',f'{base}/environments/{name}',payload=config[name])
        existing=gh('api',f'{base}/environments/{name}/deployment-branch-policies')
        policies=existing['branch_policies']
        if any(x['name']!='main' or x['type']!='branch' for x in policies): raise RuntimeError('Existing environment has non-main policies; resolve manually')
        if not policies:gh('api','--method','POST',f'{base}/environments/{name}/deployment-branch-policies',payload={'name':'main','type':'branch'})
    actual=gh('api',f'{base}/branches/main/protection')
    if not actual['enforce_admins']['enabled'] or not actual['required_pull_request_reviews']['require_code_owner_reviews']:raise RuntimeError('Protection readback failed')
    print('Protection configured; deployment remains disabled. Set environment secrets/variables, inspect settings, then enable explicitly.')

if __name__=='__main__':main()
