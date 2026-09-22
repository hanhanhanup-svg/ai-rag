$ErrorActionPreference = "Stop"

$root = if ($MyInvocation.MyCommand.Path) {
  Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
} else {
  (Get-Location).Path
}
$outputDir = Join-Path $root "docs"
$outputPath = Join-Path $outputDir "X-RAG知识库_指标管理_智能问答平台介绍.docx"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

function Get-WordColor([string]$hex) {
  $clean = $hex.TrimStart("#")
  $r = [Convert]::ToInt32($clean.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($clean.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($clean.Substring(4, 2), 16)
  return $r + ($g * 256) + ($b * 65536)
}

$colors = @{
  Navy = Get-WordColor "#172554"
  Indigo = Get-WordColor "#4F46E5"
  Violet = Get-WordColor "#7C3AED"
  Emerald = Get-WordColor "#059669"
  Amber = Get-WordColor "#D97706"
  Red = Get-WordColor "#DC2626"
  Slate = Get-WordColor "#475569"
  LightSlate = Get-WordColor "#E2E8F0"
  PaleIndigo = Get-WordColor "#EEF2FF"
  PaleEmerald = Get-WordColor "#ECFDF5"
  PaleAmber = Get-WordColor "#FFFBEB"
  PaleBlue = Get-WordColor "#EFF6FF"
  White = Get-WordColor "#FFFFFF"
  Black = Get-WordColor "#0F172A"
}

$word = $null
$doc = $null

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Add()
  $sel = $word.Selection
  $script:word = $word
  $script:doc = $doc
  $script:sel = $sel

  $doc.PageSetup.TopMargin = $word.CentimetersToPoints(1.8)
  $doc.PageSetup.BottomMargin = $word.CentimetersToPoints(1.7)
  $doc.PageSetup.LeftMargin = $word.CentimetersToPoints(2.0)
  $doc.PageSetup.RightMargin = $word.CentimetersToPoints(2.0)

  function Set-SelectionFont(
    [double]$size = 10.5,
    [bool]$bold = $false,
    [int]$color = $colors.Black,
    [string]$font = "微软雅黑"
  ) {
    $script:sel.Font.Name = $font
    $script:sel.Font.NameFarEast = $font
    $script:sel.Font.Size = $size
    $script:sel.Font.Bold = [int]$bold
    $script:sel.Font.Color = $color
  }

  function Add-Paragraph(
    [string]$text,
    [double]$size = 10.5,
    [bool]$bold = $false,
    [int]$color = $colors.Black,
    [int]$align = 0,
    [double]$before = 0,
    [double]$after = 6,
    [double]$line = 1.25
  ) {
    Set-SelectionFont -size $size -bold $bold -color $color
    $script:sel.ParagraphFormat.Alignment = $align
    $script:sel.ParagraphFormat.SpaceBefore = $before
    $script:sel.ParagraphFormat.SpaceAfter = $after
    $script:sel.ParagraphFormat.LineSpacingRule = 0
    $script:sel.ParagraphFormat.LineSpacing = $size * $line
    $script:sel.TypeText($text)
    $script:sel.TypeParagraph()
  }

  function Add-Heading([string]$text, [int]$level = 1) {
    $sizes = @{ 1 = 19; 2 = 14; 3 = 11.5 }
    $headingColors = @{ 1 = $colors.Navy; 2 = $colors.Indigo; 3 = $colors.Slate }
    $before = if ($level -eq 1) { 14 } elseif ($level -eq 2) { 10 } else { 7 }
    $after = if ($level -eq 1) { 8 } else { 5 }
    Set-SelectionFont -size $sizes[$level] -bold $true -color $headingColors[$level]
    $script:sel.ParagraphFormat.Alignment = 0
    $script:sel.ParagraphFormat.SpaceBefore = $before
    $script:sel.ParagraphFormat.SpaceAfter = $after
    $script:sel.ParagraphFormat.KeepWithNext = -1
    $script:sel.ParagraphFormat.OutlineLevel = $level
    $script:sel.TypeText($text)
    $script:sel.TypeParagraph()
  }

  function Add-Bullets([string[]]$items, [int]$color = $colors.Slate) {
    foreach ($item in $items) {
      Set-SelectionFont -size 10.5 -bold $false -color $color
      $script:sel.ParagraphFormat.Alignment = 0
      $script:sel.ParagraphFormat.LeftIndent = $word.CentimetersToPoints(0.55)
      $script:sel.ParagraphFormat.FirstLineIndent = $word.CentimetersToPoints(-0.35)
      $script:sel.ParagraphFormat.SpaceAfter = 4
      $script:sel.TypeText("•  $item")
      $script:sel.TypeParagraph()
    }
    $script:sel.ParagraphFormat.LeftIndent = 0
    $script:sel.ParagraphFormat.FirstLineIndent = 0
  }

  function Move-AfterTable($table) {
    $end = $table.Range.End
    $after = $script:doc.Range($end, $end)
    $after.InsertParagraphAfter()
    $script:sel.SetRange($after.End, $after.End)
  }

  function Add-Table(
    [string[]]$headers,
    [object[]]$rows,
    [int]$headerColor = $colors.Indigo,
    [int]$fontSize = 9,
    [int[]]$widths = @()
  ) {
    $range = $script:sel.Range
    $table = $script:doc.Tables.Add($range, $rows.Count + 1, $headers.Count)
    $table.AllowAutoFit = $true
    $table.AutoFitBehavior(2)
    $table.Borders.Enable = 1
    $table.Range.Font.Name = "微软雅黑"
    $table.Range.Font.NameFarEast = "微软雅黑"
    $table.Range.Font.Size = $fontSize
    $table.Range.ParagraphFormat.SpaceAfter = 2
    $table.Range.ParagraphFormat.SpaceBefore = 1
    $table.TopPadding = 5
    $table.BottomPadding = 5
    $table.LeftPadding = 5
    $table.RightPadding = 5

    for ($c = 1; $c -le $headers.Count; $c++) {
      $cell = $table.Cell(1, $c)
      $cell.Range.Text = $headers[$c - 1]
      $cell.Range.Font.Bold = -1
      $cell.Range.Font.Color = $colors.White
      $cell.Shading.BackgroundPatternColor = $headerColor
      $cell.VerticalAlignment = 1
      if ($widths.Count -eq $headers.Count) {
        $cell.PreferredWidthType = 2
        $cell.PreferredWidth = $widths[$c - 1]
      }
    }
    $table.Rows.Item(1).HeadingFormat = -1

    for ($r = 0; $r -lt $rows.Count; $r++) {
      for ($c = 0; $c -lt $headers.Count; $c++) {
        $cell = $table.Cell($r + 2, $c + 1)
        $cell.Range.Text = [string]$rows[$r][$c]
        $cell.Range.Font.Color = $colors.Black
        $cell.VerticalAlignment = 1
        if ($r % 2 -eq 0) {
          $cell.Shading.BackgroundPatternColor = Get-WordColor "#F8FAFC"
        }
        if ($c -eq 0) {
          $cell.Range.Font.Bold = -1
          $cell.Range.Font.Color = $colors.Indigo
        }
      }
    }
    Move-AfterTable $table
    Add-Paragraph "" -after 2
  }

  function Add-Callout([string]$title, [string]$body, [int]$fill = $colors.PaleIndigo, [int]$accent = $colors.Indigo) {
    $range = $script:sel.Range
    $table = $script:doc.Tables.Add($range, 1, 1)
    $table.Borders.Enable = 1
    $table.Borders.OutsideColor = $accent
    $table.Shading.BackgroundPatternColor = $fill
    $table.TopPadding = 9
    $table.BottomPadding = 9
    $table.LeftPadding = 10
    $table.RightPadding = 10
    $cell = $table.Cell(1, 1)
    $cell.Range.Text = "$title`r$body"
    $cell.Range.Font.Name = "微软雅黑"
    $cell.Range.Font.NameFarEast = "微软雅黑"
    $cell.Range.Font.Size = 10
    $cell.Range.Font.Color = $colors.Slate
    $cell.Range.Paragraphs.Item(1).Range.Font.Bold = -1
    $cell.Range.Paragraphs.Item(1).Range.Font.Size = 11
    $cell.Range.Paragraphs.Item(1).Range.Font.Color = $accent
    Move-AfterTable $table
    Add-Paragraph "" -after 2
  }

  function Add-Cards([object[]]$cards, [int]$columns = 4) {
    $rowCount = [Math]::Ceiling($cards.Count / $columns)
    $range = $script:sel.Range
    $table = $script:doc.Tables.Add($range, $rowCount, $columns)
    $table.Borders.Enable = 0
    $table.AllowAutoFit = $true
    $table.AutoFitBehavior(2)
    $table.TopPadding = 7
    $table.BottomPadding = 7
    $table.LeftPadding = 7
    $table.RightPadding = 7
    for ($i = 0; $i -lt ($rowCount * $columns); $i++) {
      $r = [Math]::Floor($i / $columns) + 1
      $c = ($i % $columns) + 1
      $cell = $table.Cell($r, $c)
      if ($i -lt $cards.Count) {
        $card = $cards[$i]
        $cell.Range.Text = "$($card[0])`r$($card[1])"
        $cell.Shading.BackgroundPatternColor = $card[2]
        $cell.Range.Font.Name = "微软雅黑"
        $cell.Range.Font.NameFarEast = "微软雅黑"
        $cell.Range.Font.Size = 9
        $cell.Range.Font.Color = $colors.Slate
        $cell.Range.Paragraphs.Item(1).Range.Font.Size = 20
        $cell.Range.Paragraphs.Item(1).Range.Font.Bold = -1
        $cell.Range.Paragraphs.Item(1).Range.Font.Color = $card[3]
      } else {
        $cell.Range.Text = ""
      }
    }
    Move-AfterTable $table
    Add-Paragraph "" -after 2
  }

  function Add-PageBreak {
    $script:sel.InsertBreak(7)
  }

  # Header and footer
  foreach ($section in $doc.Sections) {
    $header = $section.Headers.Item(1).Range
    $header.Text = "X-RAG 企业知识智能平台 | 产品功能介绍"
    $header.Font.Name = "微软雅黑"
    $header.Font.NameFarEast = "微软雅黑"
    $header.Font.Size = 8.5
    $header.Font.Color = $colors.Slate
    $header.ParagraphFormat.Alignment = 2

    $footer = $section.Footers.Item(1).Range
    $footer.Text = "知识库 · 指标管理 · 智能问答    "
    $footer.Font.Name = "微软雅黑"
    $footer.Font.NameFarEast = "微软雅黑"
    $footer.Font.Size = 8.5
    $footer.Font.Color = $colors.Slate
    $footer.ParagraphFormat.Alignment = 1
    $section.Footers.Item(1).PageNumbers.Add() | Out-Null
  }

  # Cover
  Add-Paragraph "X-RAG" -size 16 -bold $true -color $colors.Indigo -align 1 -before 28 -after 12
  Add-Paragraph "企业知识智能平台" -size 31 -bold $true -color $colors.Navy -align 1 -after 7
  Add-Paragraph "知识库 + 指标管理 + 智能问答" -size 18 -bold $true -color $colors.Violet -align 1 -after 14
  Add-Paragraph "项目功能介绍与详细功能清单" -size 12 -color $colors.Slate -align 1 -after 22

  Add-Cards @(
    @("知识资产中心", "统一沉淀、分类、版本与全生命周期治理", $colors.PaleIndigo, $colors.Indigo),
    @("指标与运营中心", "指标口径、质量评分、趋势与运营洞察", $colors.PaleAmber, $colors.Amber),
    @("可信问答中心", "可解释、可鉴权、可追溯的场景化问答", $colors.PaleEmerald, $colors.Emerald)
  ) 3

  Add-Paragraph "基于当前项目页面、路由、交互与模拟数据梳理" -size 10 -color $colors.Slate -align 1 -before 26 -after 5
  Add-Paragraph "文档日期：2026年6月11日" -size 10 -color $colors.Slate -align 1 -after 3
  Add-Paragraph "版本：V1.0" -size 10 -color $colors.Slate -align 1 -after 3
  Add-PageBreak

  # Overview
  Add-Heading "01  项目概览" 1
  Add-Callout "一句话定位" "X-RAG 是面向企业知识全生命周期的智能平台，将分散资料加工为可信知识资产，以指标化方式持续运营和治理，并通过可解释、可鉴权、可追溯的智能问答服务业务人员与下游应用。"
  Add-Paragraph "平台围绕「知识可信、分类精准、权限可控、调用可溯、持续优化」构建能力闭环。当前项目呈现 8 个一级模块、42 个主要功能页面，并覆盖知识生产、资产管理、质量治理、智能应用、权限安全、开放集成和系统配置。" -size 10.5 -color $colors.Slate -align 3 -after 9

  Add-Cards @(
    @("8", "一级业务模块", $colors.PaleIndigo, $colors.Indigo),
    @("42", "主要功能页面", $colors.PaleBlue, $colors.Navy),
    @("9", "智能问答场景", $colors.PaleEmerald, $colors.Emerald),
    @("7", "知识质量评分维度", $colors.PaleAmber, $colors.Amber)
  ) 4

  Add-Heading "1.1  建设目标" 2
  Add-Bullets @(
    "把 PDF、Word、Excel、PPT、网页资料、图片和音视频等非结构化内容，转化为可审核、可搜索、可问答的知识。",
    "统一管理知识库、目录、标签、版本、来源、密级、质量、有效期和调用权限，形成可信知识资产底座。",
    "将知识质量、问答效果、调用表现、知识价值和治理进度指标化，帮助管理者持续发现问题并推动闭环。",
    "通过场景化智能问答，让用户能够快速获得有依据、有边界、有来源的答案，并把反馈反哺知识治理。",
    "通过 API、Webhook 和输出适配能力，将可信知识安全接入业务系统、智能助手和第三方应用。"
  )

  Add-Heading "1.2  目标用户" 2
  Add-Table @("用户角色", "核心诉求", "平台支持") @(
    @("普通业务用户", "快速找到知识并获得可信答案", "知识搜索、智能问答、推荐问题、收藏与常用、反馈"),
    @("知识运营人员", "持续生产、审核和优化知识", "文件上传、抽取任务、审核工作台、标签与目录、质量治理"),
    @("业务管理员", "管理本业务域知识和治理任务", "业务域数据范围、知识库管理、指标驾驶舱、任务分派与复审"),
    @("安全管理员", "确保知识不被越权查看或调用", "密级、访问标签、知识鉴权策略、安全告警、操作审计"),
    @("平台管理员", "维护模型、集成、配置和平台运行", "模型配置、API 管理、Webhook、通知、字典与系统日志")
  ) $colors.Navy 9 @(16, 30, 54)

  Add-Heading "1.3  当前版本边界说明" 2
  Add-Callout "说明" "当前代码库为前端交互原型，本文功能清单按项目中已呈现的页面、交互和数据模型归纳。项目没有独立的「指标管理」一级菜单；指标能力实际分布在指标类知识、指标解释场景、质量评分模型、运营驾驶舱、调用统计、知识地图和治理任务中。本文将这些能力统一归纳为「指标与运营中心」。" $colors.PaleAmber $colors.Amber

  Add-PageBreak
  Add-Heading "02  总体能力架构" 1
  Add-Heading "2.1  三大核心中心" 2
  Add-Table @("核心中心", "能力定位", "主要成果") @(
    @("知识资产中心", "负责知识采集、加工、审核、组织、版本与生命周期管理", "形成可搜索、可问答、可复用、可追溯的可信知识资产"),
    @("指标与运营中心", "负责指标口径知识化、质量评估、运营监测、价值识别和治理闭环", "形成可度量、可比较、可预警、可整改的运营体系"),
    @("可信智能问答中心", "负责问题理解、权限校验、可信检索、结构化答案和来源解释", "形成有依据、有边界、有反馈闭环的问答服务")
  ) $colors.Indigo 9 @(20, 40, 40)

  Add-Heading "2.2  端到端业务闭环" 2
  Add-Table @("阶段", "关键动作", "项目功能") @(
    @("1. 资料接入", "上传或导入业务资料", "文件上传、知识库包导入、多格式支持"),
    @("2. AI 加工", "解析、清洗、切分、抽取并生成候选知识", "工具库、抽取技能、可视化流水线、抽取任务"),
    @("3. 人工审核", "确认知识内容、来源、标签、密级和置信度", "审核工作台、批量通过、驳回、退回重抽"),
    @("4. 资产沉淀", "进入知识库并建立目录、标签、版本和关系", "知识库、知识目录、标签体系、知识地图、版本记录"),
    @("5. 指标治理", "评估质量、价值、时效、冲突和知识缺口", "知识体检、质量评分、问题清单、治理任务、复审下架"),
    @("6. 智能应用", "面向搜索、问答、报告和业务场景提供服务", "知识搜索、智能问答、应用场景、收藏与常用"),
    @("7. 安全开放", "按用户和应用控制访问、引用、输出与调用", "权限安全、知识鉴权策略、API、Webhook、输出适配"),
    @("8. 反馈优化", "将问答反馈、调用数据和知识缺口转为治理动作", "用户反馈、TOP10、知识缺口、整改任务、运营动态")
  ) $colors.Emerald 9 @(16, 35, 49)

  Add-Heading "2.3  一级模块全景" 2
  Add-Table @("一级模块", "页面/子模块", "定位") @(
    @("工作台", "总览、我的待办、最近使用、运营动态", "统一入口与个人工作空间"),
    @("知识资产", "知识库、知识目录、标签体系、知识地图、版本记录", "统一管理企业知识资产"),
    @("知识生产", "文件上传、抽取任务、抽取技能、工具库", "将资料自动加工为候选知识"),
    @("知识应用", "智能问答、知识搜索、应用场景、收藏与常用、用户反馈", "面向业务用户提供知识服务"),
    @("质量治理", "知识体检、问题清单、治理任务、冲突合并、复审下架、治理规则", "持续提升知识健康度与可用性"),
    @("权限安全", "权限概览、密级、访问标签、用户角色、SSO、告警、鉴权、审计", "控制知识使用边界"),
    @("开放集成", "API、应用接入、输出适配、Webhook、调用日志", "对外提供可信知识能力"),
    @("系统设置", "基础、通知、字典、模型、系统日志", "平台配置与运行维护")
  ) $colors.Navy 8.5 @(16, 47, 37)

  Add-PageBreak
  Add-Heading "03  核心一：知识库与知识资产管理" 1
  Add-Paragraph "知识资产中心覆盖「建库、接入、加工、审核、组织、检索、治理、版本和生命周期」全过程。其核心不是简单存文件，而是把资料变成具备来源、标签、密级、质量、状态和应用边界的可信知识对象。" -size 10.5 -color $colors.Slate -align 3

  Add-Heading "3.1  知识资产能力摘要" 2
  Add-Cards @(
    @("多空间", "个人 / 部门 / 企业 / 平台知识库", $colors.PaleIndigo, $colors.Indigo),
    @("多类型", "FAQ / SOP / 文本块 / 实体 / 政策 / 合同 / 合规", $colors.PaleBlue, $colors.Navy),
    @("多维治理", "目录 / 标签 / 密级 / 质量 / 版本 / 有效期", $colors.PaleEmerald, $colors.Emerald),
    @("全链路", "上传 / 抽取 / 审核 / 入库 / 治理 / 应用", $colors.PaleAmber, $colors.Amber)
  ) 4

  $knowledgeFeatures = @(
    @("K-01", "知识库分层管理", "支持个人、部门、企业、平台四类知识空间；按角色与业务域展示可见知识库。", "统一承载不同范围的知识资产"),
    @("K-02", "新建知识库", "配置名称、空间类型、图标颜色、默认密级和业务描述。", "快速建立业务知识空间"),
    @("K-03", "知识库包导入", "提供知识库包导入入口，便于迁移或批量初始化。", "降低知识迁移成本"),
    @("K-04", "知识库状态卡片", "展示知识条目数、待审核数、质量分、状态、负责人和创建时间。", "快速掌握知识库健康状态"),
    @("K-05", "知识库统计与设置", "支持打开知识库、查看统计和进入配置。", "便于日常运营管理"),
    @("K-06", "目录树管理", "按知识库与业务分类组织知识，支持新建分类和查看分类内容。", "建立清晰的知识导航"),
    @("K-07", "知识移动", "支持将知识条目移动至其他分类。", "持续优化知识组织结构"),
    @("K-08", "批量标签与密级", "支持批量设置标签、批量调整知识密级。", "提高资产治理效率"),
    @("K-09", "统一知识详情", "展示知识标题、摘要、类型、来源、标签、密级、质量、状态、版本和审核信息。", "形成知识身份证与可信元数据"),
    @("K-10", "五类治理标签", "领域、场景、知识类型、权限、输出五类标签参与检索、问答、鉴权和输出控制。", "让分类直接服务业务调用"),
    @("K-11", "标签统计", "展示标签数量、使用频次、关联知识数、治理关系和纠偏置信度。", "识别高价值和异常标签"),
    @("K-12", "标签合并与纠偏", "支持合并标签、自动纠偏扫描、查看关联知识和批量补齐。", "降低标签冲突与缺失"),
    @("K-13", "知识全景矩阵", "按知识库与知识类型展示知识沉淀分布。", "识别覆盖程度与结构问题"),
    @("K-14", "知识关系图谱", "展示包含、关联、引用和同源等知识关系。", "支持关联发现与溯源"),
    @("K-15", "知识盲区地图", "将未覆盖的知识库与知识类型转成可执行补充项。", "推动知识缺口补齐"),
    @("K-16", "时效热力图", "按月份和知识类型观察更新活跃度，并识别长期停滞类型。", "避免知识长期失活"),
    @("K-17", "问题到调用效果链路", "关联高频问题、标签、场景、知识以及命中率、满意度、调用量。", "解释知识如何产生业务价值"),
    @("K-18", "版本记录", "记录版本号、修改人、修改时间、变更说明和版本状态。", "完整保留知识变化历史"),
    @("K-19", "版本差异与回滚", "支持查看差异、回滚历史版本和设为当前版本。", "确保知识更新可控可恢复"),
    @("K-20", "多格式资料上传", "支持 PDF、Word、Excel、PPT、TXT、图片、音视频和 ZIP。", "覆盖常见企业资料形态"),
    @("K-21", "批量与大文件接入", "界面配置单文件最大 500MB、批量最多 100 个文件。", "满足批量知识生产"),
    @("K-22", "抽取任务配置", "选择目标知识库、知识类型、默认密级和抽取技能。", "让知识加工结果可控"),
    @("K-23", "智能加工开关", "支持自动打标、进入审核、生成摘要、生成问题变体。", "提高知识完整性和召回能力"),
    @("K-24", "抽取任务全流程", "展示上传、解析、抽取、候选生成、审核入库等阶段与进度。", "透明掌握处理进度"),
    @("K-25", "候选知识预览", "查看候选类型、标题、置信度和原文来源。", "审核前快速判断抽取质量"),
    @("K-26", "任务历史与异常处理", "查看历史记录、异常原因、影响、运行日志，并支持重试、取消和导出。", "保障知识生产稳定可追溯"),
    @("K-27", "处理工具库", "管理解析、清洗、切分、抽取、知识构建五类工具。", "沉淀可复用的加工能力"),
    @("K-28", "工具运行指标", "展示调用次数、平均耗时、成功率、输入输出和参数说明。", "评估工具性能与稳定性"),
    @("K-29", "可视化抽取技能", "通过流程图编排工具步骤，支持添加、调整、复制、测试和保存。", "灵活配置不同文档的加工流水线"),
    @("K-30", "技能参数与测试", "配置切片长度、重叠长度、置信度阈值、重试次数，并支持样例预览。", "提高抽取效果可控性"),
    @("K-31", "人工审核工作台", "展示知识类型、状态、置信度、知识库、来源、提交人和 SLA。", "确保入库前有人审、有依据"),
    @("K-32", "审核处置", "支持编辑、通过、驳回、退回重抽和高置信候选批量通过。", "提升审核效率和质量"),
    @("K-33", "问题清单", "集中呈现摘要缺失、问题变体不足、标签缺失、来源不清和低质量问题。", "让质量问题可见可处理"),
    @("K-34", "冲突合并", "识别重复、内容、版本和跨库冲突，支持保留、合并或标记不冲突。", "避免问答引用矛盾知识"),
    @("K-35", "复审与下架", "管理即将到期、已过期、长期未更新和已下架知识，支持延期、复审、下架。", "保持知识长期有效可信")
  )

  Add-Heading "3.2  知识库详细功能清单" 2
  Add-Table @("编号", "功能", "详细说明", "业务价值") $knowledgeFeatures $colors.Indigo 8.2 @(9, 19, 47, 25)

  Add-PageBreak
  Add-Heading "04  核心二：指标管理与运营驾驶舱" 1
  Add-Callout "能力定位" "项目中的指标能力由「指标类知识与指标解释、质量评分模型、运营驾驶舱、知识价值分析、问答效果指标、调用与性能指标、治理任务指标」共同组成。它既管理业务指标口径，也度量知识平台自身的运行效果。"

  Add-Heading "4.1  指标管理的四层结构" 2
  Add-Table @("层级", "管理对象", "代表能力") @(
    @("业务指标知识层", "指标口径、公式、数据来源、适用场景、版本和有效性", "指标类知识、指标解释场景、精准搜索、版本与来源追溯"),
    @("知识质量指标层", "权威性、完整性、时效、一致性、相关性、反馈、冲突风险", "质量评分模型、S-D 分级、健康度趋势、知识库质量对比"),
    @("知识运营指标层", "可信率、高价值知识、冲突、过期、知识缺口、新增知识", "精准治理驾驶舱、TOP10、知识地图、治理任务"),
    @("服务运行指标层", "问答命中、满意度、调用量、成功率、响应时间、Token、技能性能", "场景表现、API 统计、调用日志、工具与技能统计")
  ) $colors.Amber 9 @(20, 38, 42)

  $metricFeatures = @(
    @("M-01", "指标类知识纳管", "将指标说明作为知识类型参与目录、标签、搜索、问答和治理。", "统一沉淀指标口径知识"),
    @("M-02", "指标解释场景", "智能问答支持解释指标口径、公式和数据来源。", "降低业务理解与沟通成本"),
    @("M-03", "指标可信依据", "指标解释可关联来源文件、章节位置、可信等级、质量评分、版本和状态。", "确保指标解释有据可查"),
    @("M-04", "指标口径一致性治理", "通过准确一致性评分、冲突识别、版本管理和整改任务处理口径不一致。", "减少多部门指标口径冲突"),
    @("M-05", "指标变更影响发现", "通过知识缺口、用户问题和历史报告相关问题发现口径变更影响。", "推动指标变更闭环管理"),
    @("M-06", "知识质量评分模型", "按来源权威性、内容完整性、时效有效性、准确一致性、业务相关性、用户反馈、冲突风险综合评分。", "形成统一质量评价标准"),
    @("M-07", "质量权重配置表达", "项目展示七项评分维度及权重，可作为后续可配置评分模型基础。", "让质量分计算透明可解释"),
    @("M-08", "S-D 质量分级", "S级权威优先召回，A级可正式问答，B级辅助，C级降权，D级不参与正式问答。", "将指标直接作用于检索与问答"),
    @("M-09", "知识健康度", "展示整体健康度、待修复知识、高风险知识和本月已修复。", "快速判断知识资产健康状态"),
    @("M-10", "健康度趋势", "支持按整体、知识类型和知识库切换查看趋势。", "观察治理成效和变化方向"),
    @("M-11", "知识库质量对比", "横向比较不同知识库的质量表现。", "识别薄弱知识空间"),
    @("M-12", "精准治理驾驶舱", "展示知识可信率、高价值知识数、待鉴权数、冲突数、过期数、问答准确率、缺口数和新增知识。", "为管理者提供全局运营视角"),
    @("M-13", "高价值知识 TOP10", "按调用量、可信等级和质量评分识别高价值知识。", "支持优先维护与推广"),
    @("M-14", "高频问题 TOP10", "按问题、场景、命中率和关联知识数识别用户真实需求。", "反推知识与场景建设"),
    @("M-15", "知识缺口 TOP10", "记录未稳定命中的高频问题、出现次数和建议责任部门。", "把问不到转为补知识任务"),
    @("M-16", "知识价值指标", "综合搜索次数、问答调用、报告引用、点赞、纠错、专家推荐、场景覆盖和更新时间。", "评价知识的真实使用价值"),
    @("M-17", "问答效果指标", "在知识地图中持续观察命中率、满意度和累计调用。", "量化智能问答效果"),
    @("M-18", "应用场景指标", "展示每个业务场景的调用量、命中率、知识范围和状态。", "评估场景落地表现"),
    @("M-19", "API 服务指标", "展示接入应用、本月调用、成功率、平均响应、耗时、Token 和错误信息。", "监控知识服务稳定性"),
    @("M-20", "工具与技能性能指标", "统计调用次数、成功率、平均耗时、可用率和调用趋势。", "优化知识生产效率"),
    @("M-21", "审核运营指标", "统计今日待处理、已审核、SLA 超时、平均审核时长和驳回率。", "提升审核运营效率"),
    @("M-22", "治理任务指标", "统计待处理、处理中、已完成、已逾期，并按责任人、优先级和截止时间管理。", "确保治理行动落地"),
    @("M-23", "生命周期指标", "统计即将到期、已过期、长期未更新和已下架数量。", "预防失效知识继续被使用"),
    @("M-24", "体检报告导出", "支持按知识库与时间范围筛选并导出知识体检报告。", "便于汇报、审计和专项治理"),
    @("M-25", "指标驱动动作", "从指标异常直接发起 AI 修复、整改任务、复审、延期、下架或补充知识。", "实现从看数到行动的闭环")
  )

  Add-Heading "4.2  指标管理详细功能清单" 2
  Add-Table @("编号", "功能", "详细说明", "业务价值") $metricFeatures $colors.Amber 8.2 @(9, 19, 47, 25)

  Add-PageBreak
  Add-Heading "05  核心三：可信智能问答" 1
  Add-Paragraph "可信智能问答不是单纯调用大模型生成文本，而是先识别用户意图和场景，再限定知识范围、校验权限、优先召回高质量知识，最后输出结构化答案并展示来源依据与使用边界。" -size 10.5 -color $colors.Slate -align 3

  Add-Heading "5.1  问答处理链路" 2
  Add-Table @("步骤", "系统动作", "用户可感知结果") @(
    @("1. 理解问题", "识别意图、领域、标签和应用场景", "知道系统如何理解问题"),
    @("2. 确定策略", "选择答案模板、检索范围和调用策略", "答案结构与场景匹配"),
    @("3. 权限校验", "校验用户角色、业务域、知识库、密级与输出标签", "不会通过问答绕过权限"),
    @("4. 可信检索", "优先召回已审核、当前有效、A级以上知识", "命中结果更稳定可信"),
    @("5. 生成答案", "按结论、场景、步骤、责任、风险和依据组织答案", "答案清晰、可执行"),
    @("6. 展示依据", "展示来源文件、章节、可信等级、质量分、版本和权限状态", "答案可解释、可追溯"),
    @("7. 记录反馈", "记录有帮助、不准确、需要补充和人工确认", "反馈进入质量治理闭环")
  ) $colors.Emerald 9 @(15, 42, 43)

  $qaFeatures = @(
    @("Q-01", "九类问答场景", "支持制度查询、流程咨询、指标解释、报告生成、方案编写、标书辅助、客服问答、风险合规判断、项目经验参考。", "让答案适配不同业务任务"),
    @("Q-02", "场景切换", "用户可主动选择场景，不同场景影响标签匹配、答案模板和输出权限。", "提高回答针对性"),
    @("Q-03", "推荐问题", "展示常见问题并支持一键提问。", "降低用户使用门槛"),
    @("Q-04", "问题意图识别", "自动识别问题属于流程、制度、指标、合规等意图。", "为后续检索与答案组织定向"),
    @("Q-05", "领域与标签匹配", "自动推断领域标签和主题标签。", "提高知识召回准确性"),
    @("Q-06", "场景与模板匹配", "自动匹配业务场景和答案模板。", "输出更符合业务表达"),
    @("Q-07", "检索范围限定", "限定知识库、审核状态、有效状态和可信等级。", "避免低质量或失效知识进入答案"),
    @("Q-08", "调用策略解释", "展示优先调用哪些知识类型以及补充策略。", "提升系统透明度"),
    @("Q-09", "八维精准过滤", "可按领域、类型、可信等级、质量评分、知识状态、权限状态、场景标签、输出标签筛选。", "支持精细化知识检索"),
    @("Q-10", "可信排序", "按可信等级、质量评分、权限状态和场景匹配进行排序。", "优先使用最可信知识"),
    @("Q-11", "命中原因解释", "展示为何命中、匹配标签和适用场景。", "用户可判断检索结果是否合理"),
    @("Q-12", "结构化答案", "答案按结论、适用场景、办理步骤、责任部门、风险提示和来源依据组织。", "让回答直接可执行"),
    @("Q-13", "来源证据展示", "展示来源文件、章节位置、可信等级、质量评分、知识状态和权限状态。", "支撑核验与审计"),
    @("Q-14", "多知识依据", "答案可基于多条权威知识共同生成，并展示各自命中原因。", "提高答案完整性"),
    @("Q-15", "知识身份证", "查看知识编码、来源、责任人、标签、密级、版本、有效期和调用边界。", "深入核验答案依据"),
    @("Q-16", "知识级权限校验", "按角色、部门、场景、密级控制查看、引用、下载、编辑、审核和智能体调用。", "防止问答绕过知识权限"),
    @("Q-17", "输出边界控制", "区分可问答、可引用、可生成报告、可用于标书、可对外输出等权限。", "降低敏感内容外发风险"),
    @("Q-18", "可信调用状态", "展示权限边界、输出控制和调用留痕。", "用户明确答案能如何使用"),
    @("Q-19", "调用留痕", "记录问题、命中知识、版本、调用场景和反馈。", "支持审计与效果分析"),
    @("Q-20", "问答反馈", "支持有帮助、不准确、需要补充和申请人工确认。", "持续收集真实使用反馈"),
    @("Q-21", "反馈转治理任务", "答案不准、找不到、过期和权限问题可进入处理闭环。", "推动知识持续优化"),
    @("Q-22", "知识搜索联动", "智能问答与精准搜索共享可信等级、质量、权限、状态和来源能力。", "提供查询与问答双入口"),
    @("Q-23", "知识缺口发现", "将高频但无法稳定回答的问题识别为知识缺口。", "用真实问题驱动知识建设"),
    @("Q-24", "场景效果分析", "按场景查看调用量、命中率和知识范围。", "持续优化问答场景"),
    @("Q-25", "模型可配置", "管理员可配置问答、Embedding、重排和摘要模型并进行测试与切换。", "保障智能能力可控可替换")
  )

  Add-Heading "5.2  智能问答详细功能清单" 2
  Add-Table @("编号", "功能", "详细说明", "业务价值") $qaFeatures $colors.Emerald 8.2 @(9, 19, 47, 25)

  Add-PageBreak
  Add-Heading "06  支撑能力：权限安全与开放集成" 1
  Add-Heading "6.1  权限安全" 2
  Add-Table @("能力", "详细说明", "价值") @(
    @("角色与业务域", "项目内置超级管理员、营销业务管理员、人资业务管理员等身份，按业务域和知识库范围展示数据。", "实现分域分权管理"),
    @("密级控制", "支持公开、内部、机密、绝密及用户最高密级控制。", "保护敏感知识"),
    @("访问标签", "使用部门、职级、项目组等标签控制可见范围。", "提供更细粒度授权"),
    @("知识鉴权策略", "按知识范围、类型、密级、角色、部门和场景配置查看、引用、下载、编辑、审核、智能体调用和对外输出。", "阻止越权访问与调用"),
    @("用户与角色", "维护用户、角色权限矩阵、可访问知识库和最高密级。", "统一权限运营"),
    @("SSO 配置", "支持企业统一身份认证配置入口，可扩展 SAML 或 OIDC。", "降低账号管理成本"),
    @("安全告警", "关注越权访问、异常调用、密级变更和敏感知识导出风险。", "及时发现安全事件"),
    @("操作审计", "记录审核、质量扫描、权限变更、应用接入等关键操作。", "满足追溯与审计要求")
  ) $colors.Red 8.7 @(23, 52, 25)

  Add-Heading "6.2  开放集成" 2
  Add-Table @("能力", "详细说明", "价值") @(
    @("API 应用管理", "为下游应用生成 API Key，控制可访问知识库、最高密级、状态和调用权限。", "安全开放知识服务"),
    @("API 运行监控", "查看调用量、成功率、平均响应、耗时、Token 用量和错误信息。", "保障接口稳定运行"),
    @("限流策略", "配置每分钟调用限制和每日调用上限。", "避免异常流量影响业务"),
    @("应用接入", "管理下游业务应用的知识范围、调用量、命中率和状态。", "统一管理知识消费方"),
    @("输出适配", "将标准知识输出转换为目标系统需要的结构和格式。", "降低系统对接成本"),
    @("Webhook", "在知识审核通过、更新、下架或质量问题产生时通知业务系统。", "实现事件驱动同步"),
    @("调用日志", "记录应用、接口、知识库、状态、耗时、Token 和错误。", "支持问题排查与成本分析")
  ) $colors.Violet 8.7 @(23, 52, 25)

  Add-PageBreak
  Add-Heading "07  典型业务场景" 1
  Add-Table @("场景", "业务过程", "使用能力", "产出") @(
    @("制度与流程问答", "员工询问制度条款或办理流程", "意图识别、可信检索、结构化答案、来源依据、权限校验", "可执行、可核验的流程答案"),
    @("指标口径解释", "业务人员询问某指标如何计算、数据来自哪里", "指标类知识、指标解释场景、版本与来源、口径一致性治理", "统一的指标解释与可信依据"),
    @("资料自动入库", "运营人员批量上传制度、手册、表格等资料", "文件上传、抽取技能、工具链、候选预览、审核入库", "结构化可信知识"),
    @("知识质量专项治理", "管理者发现健康度下降或问答命中不足", "体检、评分、问题清单、AI 修复、整改任务、趋势", "可跟踪的治理闭环"),
    @("高价值知识运营", "识别被频繁搜索、问答和报告引用的知识", "高价值知识、调用指标、反馈、专家推荐、场景覆盖", "优先维护与推广清单"),
    @("知识安全开放", "将知识能力接入客服助手或业务系统", "应用接入、API Key、密级、鉴权策略、限流、调用日志", "可控的知识服务接口"),
    @("知识生命周期管理", "制度更新、过期或长期未维护", "版本差异、复审、延期、下架、冲突合并、通知", "持续有效的知识资产")
  ) $colors.Navy 8.5 @(18, 28, 34, 20)

  Add-Heading "7.1  示例：指标口径智能问答闭环" 2
  Add-Bullets @(
    "用户提出「数据质量达标率如何计算？」。",
    "系统识别为「指标解释」场景，匹配数据质量、指标口径、整改验收等标签。",
    "按当前用户权限限定知识范围，优先召回当前有效、已审核、A级以上的指标与制度知识。",
    "答案说明指标口径、公式、数据来源、适用范围、风险提示和来源依据。",
    "用户可以查看知识版本、质量评分、来源章节和输出权限；若答案不准确，可直接反馈。",
    "反馈进入知识质量治理；若发现口径冲突，可创建「统一数据质量达标率口径」整改任务并跟踪闭环。"
  )

  Add-PageBreak
  Add-Heading "08  项目亮点与业务价值" 1
  Add-Table @("亮点", "项目体现", "业务价值") @(
    @("从文件库升级为知识资产库", "每条知识具备来源、标签、密级、质量、版本、有效期和调用边界。", "知识可管理、可核验、可复用"),
    @("从静态管理升级为指标运营", "用可信率、健康度、命中率、价值指标、缺口和任务度量运营效果。", "管理者能够看见问题与成效"),
    @("从大模型回答升级为可信问答", "问题理解、权限校验、可信召回、结构化答案、来源证据和留痕。", "降低幻觉、越权和误用风险"),
    @("从单点修复升级为治理闭环", "体检发现问题，自动修复或转任务，复审验收后持续观察趋势。", "持续提升知识质量"),
    @("从平台内使用升级为开放服务", "通过 API、Webhook 和输出适配接入业务应用。", "让知识能力进入真实业务流程"),
    @("从统一视图升级为角色化体验", "不同角色、业务域和知识库范围看到不同数据与功能。", "兼顾易用性与安全性")
  ) $colors.Indigo 8.7 @(21, 46, 33)

  Add-Heading "8.1  可用于汇报的核心价值表达" 2
  Add-Callout "知识更可信" "知识进入应用前经过来源、审核、质量、版本和有效期治理；回答能够展示依据，并受权限与输出边界约束。" $colors.PaleEmerald $colors.Emerald
  Add-Callout "管理更可量化" "从知识健康度、可信率、问答准确率到调用量、满意度、知识缺口和治理任务，平台把知识运营转化为可观察、可行动的指标体系。" $colors.PaleAmber $colors.Amber
  Add-Callout "业务使用更高效" "业务人员通过搜索和问答快速获得制度、流程、指标和合规信息；运营人员通过自动抽取和治理闭环降低知识维护成本。" $colors.PaleIndigo $colors.Indigo

  Add-PageBreak
  Add-Heading "09  建议的后续建设方向" 1
  Add-Paragraph "以下方向基于当前前端原型能力延伸，适合作为产品落地和二期规划参考。" -size 10.5 -color $colors.Slate
  Add-Table @("优先级", "建设方向", "建议内容") @(
    @("P0", "真实数据与服务接入", "对接对象存储、解析服务、向量数据库、检索服务、大模型、权限中心和审计存储，形成真实闭环。"),
    @("P0", "独立指标资产模块", "增加指标目录、指标定义、计算公式、数据来源、维度、负责人、审批、发布、血缘和变更影响分析。"),
    @("P0", "权限策略落地", "将前端展示的角色、密级、访问标签和知识鉴权策略落实到检索与问答服务端。"),
    @("P1", "质量规则配置化", "支持评分维度、权重、阈值、S-D 分级和治理规则按业务域配置。"),
    @("P1", "评测与问答监控", "建设问题集、自动评测、人工抽检、幻觉率、引用准确率、拒答准确率和延迟成本监控。"),
    @("P1", "知识血缘与影响分析", "展示来源文件、抽取任务、知识版本、问答引用、报告引用和下游应用之间的完整血缘。"),
    @("P2", "自动化治理编排", "基于规则和指标阈值自动创建任务、通知责任人、执行复审或限制调用。"),
    @("P2", "多租户与多组织能力", "支持集团、子公司、部门、项目组等更复杂的数据隔离和授权模型。")
  ) $colors.Violet 8.7 @(12, 25, 63)

  Add-Heading "10  总结" 1
  Add-Paragraph "X-RAG 当前项目已经形成较完整的企业知识智能平台产品框架：以知识库为资产底座，以指标与质量治理为运营抓手，以可信智能问答为业务入口，并通过权限安全和开放集成保障知识能够安全、持续地服务业务。" -size 11 -bold $true -color $colors.Navy -align 3 -after 9
  Add-Paragraph "其核心竞争力在于：知识不只是被存储，而是被加工、审核、度量、治理和调用；答案不只是被生成，而是有来源、有权限、有边界、有反馈；指标不只是被展示，而是能够触发修复、复审和补充任务，推动知识体系持续进化。" -size 10.5 -color $colors.Slate -align 3 -after 12
  Add-Callout "最终目标" "让企业知识从「分散资料」变为「可信资产」，从「经验查找」变为「智能问答」，从「被动维护」变为「指标驱动的持续运营」。" $colors.PaleIndigo $colors.Indigo

  # Apply document-wide defaults and save.
  $doc.Content.Font.Name = "微软雅黑"
  $doc.Content.Font.NameFarEast = "微软雅黑"
  $doc.Content.Fields.Update() | Out-Null
  $doc.SaveAs($outputPath, 12)
  $doc.Close()
  $doc = $null
  try { $word.Quit() } catch {}
  $word = $null

  Write-Output $outputPath
}
finally {
  if ($doc -ne $null) {
    try { $doc.Close($false) } catch {}
  }
  if ($word -ne $null) {
    try { $word.Quit() } catch {}
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
