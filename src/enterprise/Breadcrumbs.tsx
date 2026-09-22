import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { currentCenter, currentPageTitle, type NavigationCenter } from './navigation';
import './breadcrumbs.css';

export type Crumb = {label:string;to?:string};
type PagePath = {key:string;items:Crumb[]};
const PathContext=createContext<{details:PagePath|null;setDetails:(value:PagePath|null)=>void}|null>(null);
export function BreadcrumbProvider({children}:{children:ReactNode}) {
  const [details,setDetails]=useState<PagePath|null>(null);
  const value=useMemo(()=>({details,setDetails}),[details]);
  return <PathContext.Provider value={value}>{children}</PathContext.Provider>;
}
/** Detail pages contribute only names returned by their existing permission-checked requests. */
export function usePageBreadcrumbs(items:Crumb[]|null) {
  const context=useContext(PathContext);const location=useLocation();const setDetails=context?.setDetails;
  const key=location.pathname+location.search;const signature=JSON.stringify(items);
  useEffect(()=>{if(!setDetails)return;setDetails(items?{key,items}:null);return()=>setDetails(null);},[key,signature,setDetails]);
}
export const documentTabNames:Record<string,string>={content:'原文与解析',evidence:'证据与关系复核',metadata:'文档信息',versions:'版本记录',events:'操作记录',maintenance:'原文与解析'};
export const assetCrumbs:Crumb[]=[{label:'知识资产',to:'/assets/knowledge-bases'},{label:'知识库矩阵',to:'/assets/knowledge-bases'}];
export function FunctionalBreadcrumbs({centers}:{centers:NavigationCenter[]}) {
  const location=useLocation();const context=useContext(PathContext);const active=currentCenter(centers,location.pathname);
  const pageLabel=currentPageTitle(active,location.pathname);const root={label:'工作台',to:'/workspace/overview'};
  let items:Crumb[];
  if(context?.details?.key===location.pathname+location.search)items=[root,...context.details.items];
  else if(location.pathname==='/workspace/overview')items=[root];
  else if(location.pathname==='/operations/overview')items=[root,{label:'运营总览'}];
  else if(location.pathname==='/settings/account')items=[root,{label:'个人账号'}];
  else items=[root,{label:active.label,to:active.to},...(pageLabel!==active.label?[{label:pageLabel}]:[])];
  return <nav className="e-functional-path" aria-label="功能路径"><ol>{items.map((item,index)=><li key={`${index}-${item.label}`}>
    {index>0&&<ChevronRight size={12} aria-hidden="true"/>}
    {index===items.length-1?<span aria-current="page">{item.label}</span>:item.to?<Link to={item.to}>{item.label}</Link>:<span>{item.label}</span>}
  </li>)}</ol></nav>;
}
