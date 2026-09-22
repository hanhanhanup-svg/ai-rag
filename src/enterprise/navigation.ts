import { Activity, BookOpen, Boxes, Database, FileInput, FileText, FolderSync, History, LayoutDashboard, ListChecks, MessageSquare, Network, Search, Settings, ShieldCheck, Sparkles, Users, type LucideIcon } from 'lucide-react';
import type { User } from './types';
export interface NavigationLink {to:string;label:string;icon:LucideIcon}
export interface NavigationCenter extends NavigationLink {id:string;description:string;items:NavigationLink[]}
export function navigationFor(user:User):NavigationCenter[]{
  const editor=user.role!=='viewer',admin=user.role==='admin';
  return [
    {id:'workspace',to:'/workspace/overview',label:'工作台',icon:LayoutDashboard,description:'任务、待办与近期知识',items:[]},
    {id:'application',to:'/application/hub',label:'知识应用',icon:Sparkles,description:'围绕业务任务使用知识',items:[
      {to:'/application/hub',label:'业务场景',icon:Boxes},{to:'/application/find',label:'综合查找',icon:Sparkles},{to:'/application/search',label:'知识搜索',icon:Search},{to:'/application/chat',label:'智能问答',icon:MessageSquare},{to:'/application/favorites',label:'我的收藏',icon:BookOpen},{to:'/application/feedback',label:'我的反馈',icon:MessageSquare},...(admin?[{to:'/application/scenarios',label:'场景配置与发布',icon:Settings}]:[])]},
    {id:'assets',to:'/assets/knowledge-bases',label:'知识资产',icon:Database,description:'业务知识空间与证据',items:[{to:'/assets/knowledge-bases',label:'知识库矩阵',icon:Database},{to:'/assets/documents',label:'知识文档',icon:FileText},{to:'/assets/objects',label:'业务对象',icon:Boxes},{to:'/assets/knowledge-cards',label:'知识卡片',icon:BookOpen},{to:'/assets/demand-pool',label:'知识需求池',icon:ListChecks},{to:'/assets/graph',label:'知识图谱',icon:Network}]},
    ...(editor?[
      {id:'production',to:'/production/overview',label:'接入加工',icon:FileInput,description:'接入、解析与人工校对',items:[{to:'/production/upload',label:'文件接入',icon:FileInput},...(admin?[{to:'/integration/apps',label:'资料源同步',icon:FolderSync}]:[]),{to:'/production/tasks',label:'解析、索引与属性标注',icon:ListChecks}]},
      {id:'governance',to:'/governance/overview',label:'知识资产治理',icon:ShieldCheck,description:'核验问题、修订、复测与运行追踪',items:[
        {to:'/governance/overview',label:'治理工作台',icon:ShieldCheck},
        {to:'/governance/knowledge-issues',label:'重复与冲突核验',icon:FileText},
        {to:'/governance/feedback',label:'反馈记录',icon:MessageSquare},
        ...(admin?[{to:'/settings/traces',label:'运行追踪与完整性补全',icon:Activity}]:[]),
      ]},
    ]:[]),
    ...(admin?[{id:'platform',to:'/settings/overview',label:'系统管理',icon:Settings,description:'模型、服务与运行配置',items:[
      {to:'/settings/overview',label:'管理总览',icon:Settings},
      {to:'/settings/models',label:'模型配置',icon:Sparkles},
      {to:'/settings/knowledge-interfaces',label:'知识库标准接口管理',icon:Network},
      {to:'/integration/services',label:'应用接口与事件',icon:Boxes},
      {to:'/settings/operations',label:'运行保障与备份',icon:Activity},
      {to:'/security/audit',label:'操作审计',icon:History},
      ...(user.authMode!=='local'?[{to:'/security/users',label:'组织与人员',icon:Users}]:[]),
    ]}]:[])
  ];
}
export function currentCenter(centers:NavigationCenter[],pathname:string){
  const exact=centers.find(c=>c.to===pathname||c.items.some(i=>i.to===pathname));
  return exact||centers.find(c=>c.id===(pathname.startsWith('/documents/')||pathname.startsWith('/assets/')?'assets':pathname.startsWith('/settings/traces')||pathname.startsWith('/governance/')?'governance':pathname.startsWith('/application/')?'application':pathname.startsWith('/production/')?'production':pathname.startsWith('/operations/')?'workspace':'platform'))||centers[0];
}
export function currentPageTitle(center:NavigationCenter,pathname:string){
  if(pathname==='/operations/overview')return '运营总览';
  return center.items.find(i=>i.to===pathname)?.label||(pathname.startsWith('/documents/')?'文档与证据':/^\/assets\/knowledge-bases\/.+/.test(pathname)?'知识库业务空间':/^\/assets\/objects\/.+/.test(pathname)?'业务对象详情':pathname==='/settings/account'?'个人账号':center.label);
}
