import type { GraphEdge, GraphNode } from './GraphTypes';
import { graphTypeLabels } from './GraphTypes';

export interface GraphLayer { id: string; index: number; name: string; subtitle: string; types: string[]; color: string }
const typeColors:Record<string,string>=Object.assign(Object.create(null),{line:'#68a8ff',station:'#44dbdc',asset:'#78a8ff',work_order:'#b294ff',fault:'#f2b270',issue:'#edca78',procedure:'#62d9b0',document:'#8cc4ce'});
const palette=['#68a8ff','#44dbdc','#b294ff','#f2b270','#62d9b0','#edca78','#8cc4ce'];
export function graphTypeColor(type:string):string {
  if(typeColors[type])return typeColors[type];
  const hash=Array.from(type).reduce((value,char)=>(value*31+char.charCodeAt(0))>>>0,0);
  return palette[hash%palette.length];
}
export function graphLayers(nodes:Pick<GraphNode,'type'>[]):GraphLayer[] {
  return [...new Set(nodes.map(node=>node.type))].sort((a,b)=>(graphTypeLabels[a]||a).localeCompare(graphTypeLabels[b]||b,'zh-CN')).map((type,index)=>({
    id:'type:'+type,index:index+1,name:graphTypeLabels[type]||type,subtitle:'来自当前资料',types:[type],color:graphTypeColor(type),
  }));
}

export interface AggregateNode {id:string;type:string;name:string;count:number;relationCount:number;evidenceCount:number;entities:GraphNode[]}
export interface AggregateEdge {id:string;source:string;target:string;count:number;edges:GraphEdge[];predicates:string[]}
export function aggregateGraph(nodes:GraphNode[],edges:GraphEdge[]) {
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const groups=new Map<string,GraphNode[]>();
  for(const node of nodes)groups.set(node.type,[...(groups.get(node.type)||[]),node]);
  const validEdges=edges.filter(edge=>byId.has(edge.subjectId)&&byId.has(edge.objectId));
  const aggregateNodes:AggregateNode[]=[...groups].map(([type,entities])=>({id:`type:${type}`,type,name:type,count:entities.length,entities,
    relationCount:validEdges.filter(edge=>byId.get(edge.subjectId)?.type===type||byId.get(edge.objectId)?.type===type).length,
    evidenceCount:new Set(entities.flatMap(node=>node.evidenceRefs?.map(ref=>ref.documentId)||[])).size,
  }));
  const links=new Map<string,AggregateEdge>();
  for(const edge of validEdges){
    const source=`type:${byId.get(edge.subjectId)!.type}`;const target=`type:${byId.get(edge.objectId)!.type}`;
    const key=JSON.stringify([source,target]);
    const link=links.get(key)||{id:`aggregate:${key}`,source,target,count:0,edges:[],predicates:[]};
    link.count++;link.edges.push(edge);if(!link.predicates.includes(edge.predicate))link.predicates.push(edge.predicate);links.set(key,link);
  }
  return {nodes:aggregateNodes,edges:[...links.values()]};
}

export interface VisualPosition {x:number;y:number;width:number;layer:GraphLayer}
export function layoutGraphNodes(nodes:Pick<GraphNode,'id'|'type'|'name'>[],options:{mobile:boolean;structure:boolean;availableWidth:number;availableHeight?:number;pathNodeIds?:string[]}) {
  const {mobile,structure,availableWidth,pathNodeIds}=options;
  const layers=graphLayers(nodes),positions=new Map<string,VisualPosition>();
  const headings:{id:string;layer:GraphLayer;x:number;y:number;width:number}[]=[];
  const columnCount=structure?Math.max(1,Math.min(4,Math.floor((availableWidth-72)/190),layers.length)):layers.length;
  const nodeWidth=structure?Math.min(176,Math.max(132,(availableWidth-72)/columnCount-36)):204;
  const pitch=structure?nodeWidth+70:278;
  let mobileRow=0;
  layers.forEach((layer,index)=>{
    const column=nodes.filter(node=>node.type===layer.types[0]).slice().sort((a,b)=>{
      const aPath=pathNodeIds?.indexOf(a.id)??-1,bPath=pathNodeIds?.indexOf(b.id)??-1;
      return aPath>=0&&bPath>=0?aPath-bPath:a.name.localeCompare(b.name,'zh-CN');
    });
    if(mobile){for(const node of column)positions.set(node.id,{x:0,y:mobileRow++*180,width:204,layer});return;}
    const x=(structure?index%columnCount:index)*pitch,y=structure?Math.floor(index/columnCount)*300:0;
    if(!structure)headings.push({id:'heading:'+layer.id,layer,x,y:y-80,width:nodeWidth});
    column.forEach((node,row)=>positions.set(node.id,{x,y:y+row*(structure?260:160),width:nodeWidth,layer}));
  });
  return {positions,headings};
}

// A relation always keeps its source direction and its own identity, including parallel evidence.
export function graphEdgeOffsets(edges:{id:string;source:string;target:string}[]) {
  const pairs=new Map<string,typeof edges>();
  for(const edge of edges){const key=JSON.stringify([edge.source,edge.target].sort());pairs.set(key,[...(pairs.get(key)||[]),edge]);}
  const offsets=new Map<string,number>();
  for(const pair of pairs.values())pair.forEach((edge,index)=>offsets.set(edge.id,(index-(pair.length-1)/2)*32));
  return offsets;
}

