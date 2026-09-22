import { Navigate, useLocation } from 'react-router-dom';
export function RetiredGovernanceRoute({kind}:{kind:'review'|'cases'}) {
  const location=useLocation();const incoming=new URLSearchParams(location.search);const next=new URLSearchParams();
  if(incoming.get('baseId'))next.set('baseId',incoming.get('baseId')!);
  if(kind==='review'){
    const documentId=incoming.get('documentId');
    if(documentId){for(const key of ['page','chunk','timeMs'])if(incoming.get(key))next.set(key,incoming.get(key)!);next.set('tab','content');return <Navigate replace to={'/documents/'+encodeURIComponent(documentId)+'?'+next}/>;}
    next.set('status','review');return <Navigate replace to={'/assets/documents?'+next}/>;
  }
  const feedbackId=incoming.get('feedbackId');
  if(feedbackId){next.set('feedbackId',feedbackId);return <Navigate replace to={'/governance/feedback?'+next}/>;}
  return <Navigate replace to={'/governance/overview'+(next.size?'?'+next:'')}/>;
}

