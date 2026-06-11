import {
  lastUserMessageText,
  normalizeServerMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";

export type ControlledToolAllowList = {
  ragKgEnabled: boolean;
  webSearchEnabled: boolean;
  academicSearchEnabled: boolean;
  designCalculationEnabled: boolean;
  structureVisualizationEnabled: boolean;
  simulationJobEnabled: boolean;
  sessionFileRagEnabled: boolean;
  userFileRagEnabled: boolean;
};

export type ControlledToolPlan = ControlledToolAllowList & {
  query: string;
  standardSearchEnabled: boolean;
  patentSearchEnabled: boolean;
};

export type ControlledAgentPlanItem = {
  id: string;
  name: string;
  allowed: boolean;
  selected: boolean;
  reason: string;
};

export type ControlledAgentPlan = {
  query: string;
  items: ControlledAgentPlanItem[];
};

const SMALL_TALK_PATTERN =
  /^(你好|您好|hi|hello|hey|早上好|晚上好|谢谢|多谢|test|测试)[!！。.\s]*$/i;

const DOMAIN_PATTERN =
  /(复合材料|耐压壳|压力壳|承压壳|深海|外压|内压|铺层|层合板|层合|碳纤维|玻璃纤维|树脂|环氧|纤维缠绕|缠绕角|屈曲|失效|tsai|wu|hashin|max\s*stress|clt|abd|刚度矩阵|安全系数|laminate|composite|buckling|pressure\s*vessel|filament\s*winding|carbon\s*fiber|glass\s*fiber|epoxy)/i;

const DESIGN_CALCULATION_PATTERN =
  /(计算|估算|换算|求|设计|外压|压力|深度|半径|长度|厚度|壁厚|密度|质量|重量|应力|安全系数|铺层比例|tsai|wu|hashin|max\s*stress|abd|pressure|depth|radius|length|thickness|density|mass|stress|safety\s*factor)/i;

const STRUCTURE_VISUALIZATION_PATTERN =
  /(可视化|示意|画|图|结构图|截面|尺寸标注|铺层截面|圆柱壳|球壳|visual|visualization|sketch|diagram|section)/i;

const SIMULATION_JOB_PATTERN =
  /(有限元|仿真|模拟|数值模拟|求解器|计算任务|分析任务|提交任务|云图|后处理|网格|边界条件|abaqus|ansys|comsol|calculix|fem|fea|finite\s*element|simulation|solver|mesh|boundary\s*condition|post[-\s]*process)/i;

const NUMERIC_ENGINEERING_PATTERN =
  /\d+(?:\.\d+)?\s*(mm|cm|m|km|pa|kpa|mpa|gpa|kg\/m3|kg\/m\^3|kg\/m³|n|kn|mn|米|毫米|厘米|千米|兆帕|吉帕|千帕|帕)/i;

const FILE_REFERENCE_PATTERN =
  /(附件|文件|文档|资料|上传|pdf|word|docx|ppt|pptx|表格|图片|图|第二张|第一张|这张|这份|这篇|上述|前面|根据.*(资料|文档|附件|文件)|uploaded|attachment|document|paper|table|figure|image)/i;

const WEB_SEARCH_PATTERN =
  /(最新|当前|今天|近期|联网|搜索|网页|官网|新闻|价格|法规|api|latest|current|recent|web|search)/i;

const STANDARD_SEARCH_PATTERN =
  /(标准|规范|规程|认证|合规|法规|iso|astm|asme|gb\/t|en\s?\d|dnv|abs|standard|specification|code|regulation|certification)/i;

const PATENT_SEARCH_PATTERN =
  /(专利|发明|申请人|公开号|授权号|patent|invention|applicant|assignee|publication\s+number)/i;

const ACADEMIC_SEARCH_PATTERN =
  /(论文|文献|研究|综述|期刊|会议|引用|doi|摘要|作者|出版|semantic\s*scholar|pubmed|scholar|paper|literature|review|journal|conference|citation|abstract)/i;

function isSmallTalk(query: string) {
  return SMALL_TALK_PATTERN.test(query);
}

function hasDomainIntent(query: string) {
  return DOMAIN_PATTERN.test(query);
}

function hasEngineeringNumbers(query: string) {
  return NUMERIC_ENGINEERING_PATTERN.test(query);
}

function needsDesignCalculation(query: string) {
  return DESIGN_CALCULATION_PATTERN.test(query) && hasEngineeringNumbers(query);
}

function needsStructureVisualization(query: string) {
  return (
    STRUCTURE_VISUALIZATION_PATTERN.test(query) && hasEngineeringNumbers(query)
  );
}

function needsSimulationJob(query: string) {
  return SIMULATION_JOB_PATTERN.test(query);
}

function needsFileKnowledge(query: string) {
  return FILE_REFERENCE_PATTERN.test(query);
}

function needsWebSearch(query: string) {
  return WEB_SEARCH_PATTERN.test(query);
}

function needsStandardSearch(query: string) {
  return STANDARD_SEARCH_PATTERN.test(query);
}

function needsPatentSearch(query: string) {
  return PATENT_SEARCH_PATTERN.test(query);
}

function needsAcademicSearch(query: string) {
  return ACADEMIC_SEARCH_PATTERN.test(query);
}

function createPlanItem(input: ControlledAgentPlanItem) {
  return input;
}

function describeToolDecision(input: {
  smallTalk: boolean;
  allowed: boolean;
  selected: boolean;
  selectedReason: string;
}) {
  if (input.smallTalk) return "对话内容为日常交流";
  if (!input.allowed) return "开关关闭";
  if (input.selected) return input.selectedReason;
  return "未触发";
}

export function planControlledChatTools(
  messages: ServerChatMessageLike[],
  allowList: ControlledToolAllowList,
): ControlledToolPlan {
  const query = normalizeServerMessageText(lastUserMessageText(messages));
  if (!query || isSmallTalk(query)) {
    return {
      query,
      ragKgEnabled: false,
      webSearchEnabled: false,
      standardSearchEnabled: false,
      patentSearchEnabled: false,
      academicSearchEnabled: false,
      designCalculationEnabled: false,
      structureVisualizationEnabled: false,
      simulationJobEnabled: false,
      sessionFileRagEnabled: false,
      userFileRagEnabled: false,
    };
  }

  const domainIntent = hasDomainIntent(query);
  const fileIntent = needsFileKnowledge(query);
  const webIntent = needsWebSearch(query);
  const standardIntent = needsStandardSearch(query);
  const patentIntent = needsPatentSearch(query);
  const academicIntent = needsAcademicSearch(query);
  const calculationIntent = needsDesignCalculation(query);
  const visualizationIntent = needsStructureVisualization(query);
  const simulationIntent = needsSimulationJob(query);

  return {
    query,
    ragKgEnabled: allowList.ragKgEnabled && (domainIntent || calculationIntent),
    webSearchEnabled:
      allowList.webSearchEnabled &&
      webIntent &&
      !standardIntent &&
      !patentIntent,
    standardSearchEnabled: allowList.webSearchEnabled && standardIntent,
    patentSearchEnabled: allowList.webSearchEnabled && patentIntent,
    academicSearchEnabled:
      allowList.academicSearchEnabled && (academicIntent || webIntent),
    designCalculationEnabled:
      allowList.designCalculationEnabled && calculationIntent,
    structureVisualizationEnabled:
      allowList.structureVisualizationEnabled && visualizationIntent,
    simulationJobEnabled: allowList.simulationJobEnabled && simulationIntent,
    sessionFileRagEnabled: allowList.sessionFileRagEnabled && fileIntent,
    userFileRagEnabled: allowList.userFileRagEnabled && fileIntent,
  };
}

export function buildControlledAgentPlan(
  messages: ServerChatMessageLike[],
  allowList: ControlledToolAllowList,
): ControlledAgentPlan {
  const decision = planControlledChatTools(messages, allowList);
  const query = decision.query;
  const hasQuery = Boolean(query);
  const smallTalk = !hasQuery || isSmallTalk(query);

  return {
    query,
    items: [
      createPlanItem({
        id: "csgpt-rag-kg",
        name: "知识库检索",
        allowed: allowList.ragKgEnabled,
        selected: decision.ragKgEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.ragKgEnabled,
          selected: decision.ragKgEnabled,
          selectedReason: "问题包含领域或工程参数",
        }),
      }),
      createPlanItem({
        id: "csgpt-web-search",
        name: "联网检索",
        allowed: allowList.webSearchEnabled,
        selected: decision.webSearchEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.webSearchEnabled,
          selected: decision.webSearchEnabled,
          selectedReason: "问题包含联网检索信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-standard-search",
        name: "标准/规范检索",
        allowed: allowList.webSearchEnabled,
        selected: decision.standardSearchEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.webSearchEnabled,
          selected: decision.standardSearchEnabled,
          selectedReason: "问题包含标准或规范检索信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-patent-search",
        name: "专利检索",
        allowed: allowList.webSearchEnabled,
        selected: decision.patentSearchEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.webSearchEnabled,
          selected: decision.patentSearchEnabled,
          selectedReason: "问题包含专利检索信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-academic-search",
        name: "学术检索",
        allowed: allowList.academicSearchEnabled,
        selected: decision.academicSearchEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.academicSearchEnabled,
          selected: decision.academicSearchEnabled,
          selectedReason: "问题包含文献或检索信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-design-calculation",
        name: "设计计算",
        allowed: allowList.designCalculationEnabled,
        selected: decision.designCalculationEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.designCalculationEnabled,
          selected: decision.designCalculationEnabled,
          selectedReason: "问题包含明确工程参数",
        }),
      }),
      createPlanItem({
        id: "csgpt-structure-visualization",
        name: "结构可视化",
        allowed: allowList.structureVisualizationEnabled,
        selected: decision.structureVisualizationEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.structureVisualizationEnabled,
          selected: decision.structureVisualizationEnabled,
          selectedReason: "问题包含结构示意或截面可视化信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-simulation-job",
        name: "仿真任务",
        allowed: allowList.simulationJobEnabled,
        selected: decision.simulationJobEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.simulationJobEnabled,
          selected: decision.simulationJobEnabled,
          selectedReason: "问题包含有限元或仿真任务信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-session-file-rag",
        name: "会话文件知识",
        allowed: allowList.sessionFileRagEnabled,
        selected: decision.sessionFileRagEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.sessionFileRagEnabled,
          selected: decision.sessionFileRagEnabled,
          selectedReason: "问题包含附件或资料信号",
        }),
      }),
      createPlanItem({
        id: "csgpt-user-file-rag",
        name: "用户文件知识",
        allowed: allowList.userFileRagEnabled,
        selected: decision.userFileRagEnabled,
        reason: describeToolDecision({
          smallTalk,
          allowed: allowList.userFileRagEnabled,
          selected: decision.userFileRagEnabled,
          selectedReason: "问题包含附件或资料信号",
        }),
      }),
    ],
  };
}
