export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  role: string;
  roleName: string;
  businessDomain: string;
  avatarText: string;
  maxSensitivityLevel: string;
  accessibleKnowledgeBases: string[];
  permissions: string[];
}

export const DEMO_USERS: CurrentUser[] = [
  {
    id: "u_super",
    name: "王强",
    username: "super_admin",
    role: "super_admin",
    roleName: "超级管理员",
    businessDomain: "全域",
    avatarText: "强",
    maxSensitivityLevel: "L4",
    accessibleKnowledgeBases: ["all"],
    permissions: ["all"]
  },
  {
    id: "u_marketing",
    name: "李娜",
    username: "marketing_admin",
    role: "business_admin",
    roleName: "营销业务管理员",
    businessDomain: "营销业务域",
    avatarText: "娜",
    maxSensitivityLevel: "L2",
    accessibleKnowledgeBases: ["营销部知识库", "售前知识库", "客户问答知识库"],
    permissions: [
      "workspace",
      "assets",
      "production",
      "application",
      "governance",
      "security_limited",
      "integration_limited"
    ]
  },
  {
    id: "u_hr",
    name: "张伟",
    username: "hr_admin",
    role: "business_admin",
    roleName: "人资业务管理员",
    businessDomain: "人资业务域",
    avatarText: "伟",
    maxSensitivityLevel: "L2",
    accessibleKnowledgeBases: ["员工制度知识库", "人事流程知识库", "考勤加班知识库"],
    permissions: ["workspace", "assets", "production", "application", "governance", "security_limited"]
  }
];

export const DEMO_PASSWORD = "123456";

export function getDemoUserById(id: string) {
  return DEMO_USERS.find((user) => user.id === id) ?? null;
}

export function getDemoUserByUsername(username: string) {
  return DEMO_USERS.find((user) => user.username === username.trim()) ?? null;
}
