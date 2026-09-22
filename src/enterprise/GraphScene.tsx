import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ReactFlow, { Background, BackgroundVariant, BaseEdge, applyNodeChanges, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Panel, Position, useNodesInitialized, useReactFlow, useStore, type Edge, type EdgeProps, type NodeChange, type Node, type NodeProps } from 'reactflow';
import { ArrowDownRight, ArrowUpRight, BookOpen, Boxes, CircleHelp, ClipboardList, FileText, Focus, Layers3, MapPin, Maximize, Minus, Move, Plus, Route, Search, TrainFront, TriangleAlert, type LucideIcon } from 'lucide-react';
import { graphRelationLabels, graphTypeLabels, type GraphEdge, type GraphNode } from './GraphTypes';
import { aggregateGraph, graphLayers, graphEdgeOffsets, graphTypeColor, layoutGraphNodes, type AggregateNode, type GraphLayer } from './graph-visual-model';
import 'reactflow/dist/style.css';
import './graph-scene.css';

export interface GraphSceneProps {
  nodes:GraphNode[]; edges:GraphEdge[]; pathNodeIds?:string[]; focusId:string;
  selection:{kind:'node'|'edge';id:string}|null;
  onNode:(node:GraphNode)=>void; onEdge:(edge:GraphEdge)=>void; onExpand:(node:GraphNode)=>void;
  presentation?:'structure'|'relations'; onType?:(type:string)=>void;
}
const typeIcons:Record<string,LucideIcon>={line:Route,station:TrainFront,asset:Boxes,work_order:ClipboardList,fault:TriangleAlert,issue:CircleHelp,procedure:BookOpen,document:FileText};
function TypeIcon({type,size=19}:{type:string;size?:number}) {const Icon=typeIcons[type]||MapPin;return <Icon size={size} strokeWidth={1.6}/>;}
const tone=(type:string)=>({'--node-color':graphTypeColor(type)} as CSSProperties);

interface EntityData {item:GraphNode;degree:number;active:boolean;dimmed:boolean;inPath:boolean;index?:number;onSelect:()=>void;onExpand:()=>void}
const EntityCard=memo(function EntityCard({data}:NodeProps<EntityData>) {
  const {item}=data;
  return <article className={`e-graph-entity-card${data.active?' is-active':''}${data.dimmed?' is-dimmed':''}${data.inPath?' in-path':''}`} style={tone(item.type)}>
    <GraphHandles/>
    <button type="button" className="e-graph-entity-select nodrag" onClick={data.onSelect} aria-label={`查看${graphTypeLabels[item.type]||item.type} ${item.name}`}>
      <div className="e-graph-entity-top"><span className="e-graph-node-icon"><TypeIcon type={item.type}/></span><span className="e-graph-node-type">{graphTypeLabels[item.type]||item.type}</span>{data.index!=null&&<span className="e-graph-path-index">{String(data.index+1).padStart(2,'0')}</span>}</div>
      <strong title={item.name}>{item.name}</strong>
      <small title={item.externalId||item.scopeLabel}>{item.externalId&&item.externalId!==item.name?item.externalId:item.scopeLabel||'有出处的知识对象'}</small>
    </button>
    <div className="e-graph-entity-bottom"><span><i/>{data.degree} 条当前关联</span><button type="button" className="nodrag" onClick={event=>{event.stopPropagation();data.onExpand();}} aria-label={`展开${item.name}的关联`}>展开<ArrowUpRight size={12}/></button></div>
  </article>;
});
interface AggregateData {item:AggregateNode;width:number;onExplore:()=>void}
const AggregateCard=memo(function AggregateCard({data}:NodeProps<AggregateData>) {
  const {item}=data;
  return <div className="e-graph-type-card" style={{...tone(item.type),width:data.width}}>
    <GraphHandles/>
    <button className="e-graph-type-select nodrag" type="button" onClick={data.onExplore} aria-label={`探索${item.count}个${graphTypeLabels[item.type]||item.type}`}>
      <div className="e-graph-type-card-top"><TypeIcon type={item.type} size={22}/><ArrowUpRight size={14}/></div>
      <div className="e-graph-type-card-value"><strong>{item.count}</strong><span>个对象</span></div>
      <h3>{graphTypeLabels[item.type]||item.type}</h3>
      <div className="e-graph-type-card-bottom"><span>{item.relationCount} 条关联</span><span>{item.evidenceCount} 份来源</span></div>
    </button>
  </div>;
});
function GraphHandles(){return <>{[Position.Left,Position.Right,Position.Top,Position.Bottom].flatMap(position=>['source','target'].map(type=><Handle key={`${type}-${position}`} type={type as 'source'|'target'} position={position} id={`${type}-${position}`} isConnectable={false}/>))}</>;}
const LayerHeading=memo(function LayerHeading({data}:NodeProps<{layer:GraphLayer;width:number}>) {return <div className="e-graph-column-heading" style={{...tone(data.layer.types[0]||'other'),width:data.width}}><span>{String(data.layer.index).padStart(2,'0')}</span><div><strong>{data.layer.name}</strong><small>{data.layer.subtitle}</small></div></div>;});

interface RelationData {offset:number;sameLayer:boolean;selfLoop:boolean;mobile:boolean;active:boolean;dimmed:boolean;showLabel:boolean;label:string;tooltip:string;aggregate:boolean;onSelect?:()=>void}
const RelationLine=memo(function RelationLine(props:EdgeProps<RelationData>) {
  const {id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,markerEnd,style,data}=props;
  const d=data!;let path:string;let labelX:number;let labelY:number;
  if(d.selfLoop){
    const bend=85+Math.abs(d.offset);
    path=`M ${sourceX} ${sourceY} C ${sourceX+bend} ${sourceY-90}, ${targetX+bend} ${targetY+90}, ${targetX} ${targetY}`;
    labelX=sourceX+bend*.75;labelY=sourceY;
  }else if(d.sameLayer&&!d.mobile){
    const bend=76+Math.abs(targetY-sourceY)*0.2+d.offset;
    path=`M ${sourceX} ${sourceY} C ${sourceX+bend} ${sourceY}, ${targetX+bend} ${targetY}, ${targetX} ${targetY}`;
    labelX=(sourceX+targetX)/2+bend*.75;labelY=(sourceY+targetY)/2;
  }else if(d.mobile){
    const direction=sourcePosition===Position.Top?-1:1;const distance=Math.max(58,Math.abs(targetY-sourceY)*.5);
    path=`M ${sourceX} ${sourceY} C ${sourceX+d.offset} ${sourceY+distance*direction}, ${targetX+d.offset} ${targetY-distance*direction}, ${targetX} ${targetY}`;
    labelX=(sourceX+targetX)/2+d.offset*.75;labelY=(sourceY+targetY)/2;
  }else{
    const sourceDirection=sourcePosition===Position.Left?-1:1;const targetDirection=targetPosition===Position.Right?1:-1;
    const distance=Math.max(38,Math.abs(targetX-sourceX)*.48);
    path=`M ${sourceX} ${sourceY} C ${sourceX+distance*sourceDirection} ${sourceY+d.offset}, ${targetX+distance*targetDirection} ${targetY+d.offset}, ${targetX} ${targetY}`;
    labelX=(sourceX+targetX)/2;labelY=(sourceY+targetY)/2+d.offset*.75;
  }
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24}/>{d.showLabel&&<EdgeLabelRenderer><div className={`e-graph-edge-label nodrag nopan${d.active?' is-active':''}${d.dimmed?' is-dimmed':''}${d.aggregate?' is-aggregate':''}`} style={{transform:`translate(-50%, -50%) translate(${labelX}px,${labelY}px)`}}>{d.onSelect?<button type="button" title={d.tooltip} onClick={event=>{event.stopPropagation();d.onSelect?.();}} aria-label={d.tooltip}>{d.label}<Search size={10}/></button>:<span title={d.tooltip} aria-label={d.tooltip}>{d.label}</span>}</div></EdgeLabelRenderer>}</>;
});
const nodeTypes={entity:EntityCard,aggregate:AggregateCard,layer:LayerHeading};
const edgeTypes={relation:RelationLine};

export function GraphScene({nodes,edges,pathNodeIds,focusId,selection,onNode,onEdge,onExpand,presentation='relations',onType}:GraphSceneProps) {
  const host=useRef<HTMLDivElement>(null);const [width,setWidth]=useState(1000);const [height,setHeight]=useState(650);const [hover,setHover]=useState<string|null>(null);
  const [renderNodes,setRenderNodes]=useState<Node[]>([]);
  const onNodesChange=useCallback((changes:NodeChange[])=>setRenderNodes(current=>applyNodeChanges(changes,current)),[]);
  useEffect(()=>{if(!host.current)return;const element=host.current;const measure=()=>{setWidth(element.clientWidth);setHeight(element.querySelector<HTMLElement>('.e-graph-scene__flow')?.clientHeight||650);};const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();},[]);
  const mobile=width<640;const structure=presentation==='structure';const compact=structure&&height<520;
  const aggregated=useMemo(()=>aggregateGraph(nodes,edges),[nodes,edges]);
  const related=useMemo(()=>{
    const selected=selection?.kind==='node'?selection.id:hover&&nodes.some(node=>node.id===hover)?hover:null;
    const edge=selection?.kind==='edge'?edges.find(item=>item.id===selection.id):hover?edges.find(item=>item.id===hover):null;
    const activeNodes=new Set<string>(selected?[selected]:edge?[edge.subjectId,edge.objectId]:[]);const activeEdges=new Set<string>();
    for(const item of edges)if((selected&&(item.subjectId===selected||item.objectId===selected))||item.id===edge?.id){activeEdges.add(item.id);activeNodes.add(item.subjectId);activeNodes.add(item.objectId);}
    return {nodes:activeNodes,edges:activeEdges,enabled:activeNodes.size>0};
  },[selection,hover,nodes,edges]);
  const plotted=useMemo(()=>{
    const layout=layoutGraphNodes(structure?aggregated.nodes:nodes,{mobile,structure,availableWidth:width,availableHeight:height,pathNodeIds});
    const nodeSet=new Set(nodes.map(node=>node.id));const validEdges=edges.filter(edge=>nodeSet.has(edge.subjectId)&&nodeSet.has(edge.objectId));
    const flowNodes:Node[]=structure?aggregated.nodes.map(item=>({id:item.id,type:'aggregate',position:layout.positions.get(item.id)!,data:{item,width:layout.positions.get(item.id)!.width,onExplore:()=>onType?.(item.type)},draggable:false,focusable:false})):nodes.map(item=>({id:item.id,type:'entity',position:layout.positions.get(item.id)!,data:{item,degree:validEdges.filter(edge=>edge.subjectId===item.id||edge.objectId===item.id).length,active:selection?.id===item.id||focusId===item.id,dimmed:related.enabled&&!related.nodes.has(item.id),inPath:!!pathNodeIds?.includes(item.id),index:pathNodeIds?.includes(item.id)?pathNodeIds.indexOf(item.id):undefined,onSelect:()=>onNode(item),onExpand:()=>onExpand(item)},draggable:false,focusable:false,zIndex:5,style:{width:204}}));
    flowNodes.unshift(...layout.headings.map(heading=>({id:heading.id,type:'layer',position:{x:heading.x,y:heading.y},data:{layer:heading.layer,width:heading.width},draggable:false,selectable:false,focusable:false,zIndex:-1})));
    const sourceEdges=structure?aggregated.edges:validEdges.map(edge=>({id:edge.id,source:edge.subjectId,target:edge.objectId,item:edge}));
    const offsets=graphEdgeOffsets(sourceEdges);
    const flowEdges:Edge<RelationData>[]=sourceEdges.map(edge=>{
      const start=layout.positions.get(edge.source)!;const end=layout.positions.get(edge.target)!;const sameLayer=start.layer.index===end.layer.index;
      const vertical=mobile||(!sameLayer&&Math.abs(start.x-end.x)<10);
      const sourcePosition=vertical?(start.y>end.y?Position.Top:Position.Bottom):sameLayer?Position.Right:start.x>end.x?Position.Left:Position.Right;
      const targetPosition=vertical?(start.y>end.y?Position.Bottom:Position.Top):sameLayer?Position.Right:start.x>end.x?Position.Right:Position.Left;
      const item='item' in edge?edge.item:undefined;const active=related.edges.has(edge.id);const dimmed=!structure&&related.enabled&&!active;
      const aggregate='count' in edge?edge:undefined;const color=active?'#78e4f0':structure?'#527da5':'#557e9f';
      return {id:edge.id,source:edge.source,target:edge.target,type:'relation',sourceHandle:`source-${sourcePosition}`,targetHandle:`target-${targetPosition}`,selectable:!structure,focusable:!structure,
        data:{offset:offsets.get(edge.id)||0,sameLayer,selfLoop:edge.source===edge.target,mobile:vertical,active,dimmed,showLabel:structure||validEdges.length<=24||active||hover===edge.id,label:aggregate?`${aggregate.count} 条`:item?.label||graphRelationLabels[item?.predicate||'']||item?.predicate||'关联',tooltip:aggregate?`${graphTypeLabels[edge.source.slice(5)]||edge.source.slice(5)} → ${graphTypeLabels[edge.target.slice(5)]||edge.target.slice(5)}：${aggregate.count} 条实际关系。${aggregate.predicates.map(value=>graphRelationLabels[value]||(value.startsWith('explicit:')?value.slice(9):value)).join('、')}。聚合数量不代表单条原文依据。`:`查看关系依据：${item?.subjectName||nodes.find(node=>node.id===edge.source)?.name} ${item?.label||graphRelationLabels[item?.predicate||'']||item?.predicate} ${item?.objectName||nodes.find(node=>node.id===edge.target)?.name}${item?.rowNumber!=null?`，来源行 ${item.rowNumber}`:''}`,aggregate:structure,onSelect:item?()=>onEdge(item):undefined},
        markerEnd:{type:MarkerType.ArrowClosed,color,width:16,height:16},style:{stroke:color,strokeWidth:active?2.25:structure?1.65:1.35,strokeOpacity:dimmed?.2:active?1:.76,strokeDasharray:item&&(item.status!=='confirmed'||item.stale)?'5 4':undefined},zIndex:active?3:0,
      };
    });
    return {nodes:flowNodes,edges:flowEdges};
  },[nodes,edges,aggregated,structure,mobile,width,height,pathNodeIds,selection,focusId,related,onNode,onEdge,onExpand,onType,hover]);
  // Preserve measured dimensions when visual attributes or layout change.
  // React Flow needs these dimensions for both edge handles and viewport fitting.
  useEffect(()=>setRenderNodes(current=>{const measured=new Map(current.map(node=>[node.id,node]));return plotted.nodes.map(node=>{const prior=measured.get(node.id);return {...node,width:prior?.width,height:prior?.height};});}),[plotted.nodes]);
  const graphKey=`${presentation}:${mobile}:${focusId}:${nodes.map(node=>node.id).join('|')}:${edges.map(edge=>edge.id).join('|')}`;
  return <div ref={host} className={`e-graph-scene ${structure?'is-structure':'is-relations'}${mobile?' is-mobile':''}${compact?' is-compact':''}`}>
    {structure&&mobile?<div className="e-graph-mobile-hierarchy" aria-label="按实际对象类型组织的图谱全景">
      {graphLayers(aggregated.nodes).map(layer=><section key={layer.id} style={tone(layer.types[0]||'other')}><div className="e-graph-mobile-layer-heading"><span>{String(layer.index).padStart(2,'0')}</span><div><h3>{layer.name}</h3><p>{layer.subtitle}</p></div></div><div className="e-graph-mobile-type-list">{aggregated.nodes.filter(node=>layer.types.includes(node.type)).map(item=><button type="button" key={item.id} onClick={()=>onType?.(item.type)}><TypeIcon type={item.type}/><span><strong>{graphTypeLabels[item.type]||item.type}</strong><small>{item.relationCount} 条当前关联</small></span><b>{item.count}</b><ArrowUpRight size={16}/></button>)}</div></section>)}
      <div className="e-graph-mobile-connections"><h3><Layers3 size={15}/>实际类型关联</h3>{aggregated.edges.map(edge=><p key={edge.id}><span>{graphTypeLabels[edge.source.slice(5)]||edge.source.slice(5)}<ArrowDownRight size={12}/>{graphTypeLabels[edge.target.slice(5)]||edge.target.slice(5)}</span><strong>{edge.count} 条</strong></p>)}</div>
    </div>:<div className="e-graph-scene__flow"><ReactFlow key={graphKey} nodes={renderNodes} onNodesChange={onNodesChange} edges={plotted.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={.12} maxZoom={1.8} nodesConnectable={false} nodesDraggable={false} deleteKeyCode={null} zoomOnScroll={false} zoomActivationKeyCode="Control" zoomOnDoubleClick={false} preventScrolling={false} panOnDrag selectionOnDrag={false}
      onNodeMouseEnter={(_event,node)=>setHover(node.id)} onNodeMouseLeave={()=>setHover(null)} onEdgeMouseEnter={(_event,edge)=>setHover(edge.id)} onEdgeMouseLeave={()=>setHover(null)}
      onNodeDoubleClick={(_event,node)=>{const item=nodes.find(item=>item.id===node.id);if(item)onExpand(item);}}
      onEdgeClick={(_event,edge)=>{const item=edges.find(item=>item.id===edge.id);if(item)onEdge(item);}}
      proOptions={{hideAttribution:true}}>
      <GraphViewport graphKey={`${graphKey}:${width}:${height}`} structure={structure} focusId={focusId}/>
      <Background id="fine" variant={BackgroundVariant.Lines} color="#183346" gap={24} lineWidth={.35}/><Background id="major" variant={BackgroundVariant.Lines} color="#214055" gap={120} lineWidth={.45}/>
      <Panel position="top-left" className="e-graph-scene-caption"><span className="e-graph-scene-signal"/><span>{structure?'实际分类 · 来源关联':pathNodeIds?.length?'证据路径 · 关联探索':'知识对象 · 关联探索'}</span></Panel>
      <SceneControls mobile={mobile}/>
      {!structure&&nodes.length>8&&<MiniMap pannable zoomable ariaLabel="图谱位置导航" nodeColor={node=>node.type==='layer'?'transparent':graphTypeColor(node.data.item?.type||'document')} nodeStrokeWidth={0} maskColor="rgba(4,13,25,.65)"/>}
    </ReactFlow></div>}
    <div className="e-graph-scene-footer"><span><i/>{structure?'卡片为当前对象的类型聚合，连线数字为实际关系条数':'关系箭头保持原文方向，选中对象聚焦当前邻域'}</span><span><Move size={12}/>{structure&&mobile?'点击类型进入关联探索':'拖动平移 · Ctrl + 滚轮缩放'}</span></div>
  </div>;
}
function GraphViewport({graphKey,structure,focusId}:{graphKey:string;structure:boolean;focusId:string}) {
  const {fitView,getNodes,setCenter}=useReactFlow();const ready=useNodesInitialized();const width=useStore(state=>state.width);const height=useStore(state=>state.height);
  const geometry=useStore(state=>[...state.nodeInternals.values()].map(node=>`${node.id}:${node.width}:${node.height}:${node.position.x}:${node.position.y}`).join('|'));
  useEffect(()=>{
    if(!ready||!width||!height)return;
    let secondFrame=0;
    const frame=requestAnimationFrame(()=>{secondFrame=requestAnimationFrame(()=>{
      const entities=getNodes().filter(node=>node.type!=='layer');
      const current=entities.find(node=>node.id===focusId);
      if(!structure&&entities.length>15&&current){void setCenter(current.position.x+102,current.position.y+70,{zoom:.85});return;}
      void fitView({padding:structure&&height<520?.055:structure?.09:.13,maxZoom:1,minZoom:structure?.45:width<640?.78:.5});
    });});return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(secondFrame);};
  },[ready,width,height,geometry,graphKey,structure,focusId,fitView,getNodes,setCenter]);
  return null;
}
function SceneControls({mobile}:{mobile:boolean}){
  const {zoomIn,zoomOut,fitView,zoomTo}=useReactFlow();const zoom=useStore(state=>state.transform[2]);
  return <Panel position={mobile?"top-right":"bottom-left"} className="e-graph-scene-controls"><button type="button" title="放大图谱" aria-label="放大图谱" onClick={()=>void zoomIn()}><Plus size={16}/></button><span aria-label={`当前缩放 ${Math.round(zoom*100)}%`}>{Math.round(zoom*100)}%</span><button type="button" title="缩小图谱" aria-label="缩小图谱" onClick={()=>void zoomOut()}><Minus size={16}/></button><i/><button type="button" title="显示全部对象" aria-label="显示全部对象" onClick={()=>void fitView({padding:.13,maxZoom:1,minZoom:.12})}><Maximize size={15}/></button><button type="button" title="恢复清晰阅读比例" aria-label="恢复清晰阅读比例" onClick={()=>void zoomTo(1)}><Focus size={16}/></button></Panel>;
}

