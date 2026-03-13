import * as cdk from "aws-cdk-lib";
import { aws_organizations as org } from "aws-cdk-lib";
import { Construct } from "constructs";

export class OrgAccountsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an Organizational Unit (OU)
    const bgOU = new org.CfnOrganizationalUnit(this, "bgOU", {
      name: "Development",
      parentId: "r-1yn8", // ← replace with your Root ID from: aws organizations list-roots
    });

    // Create Dev account
    const devAccount = new org.CfnAccount(this, "DevAccount", {
      accountName: "bg-dev-account",
      email: "brandongoodman58+dev@gmail.com", // ← must be a unique email globally
      parentIds: [bgOU.attrId],
      roleName: "OrganizationAccountAccessRole",
    });

    // Create Prod account
    const prodAccount = new org.CfnAccount(this, "ProdAccount", {
      accountName: "bg-prod-account",
      email: "brandongoodman58+prod@gmail.com", // ← must be a unique email globally
      parentIds: [bgOU.attrId],
      roleName: "OrganizationAccountAccessRole",
    });

    // Create Shared account
    const sharedAccount = new org.CfnAccount(this, "SharedAccount", {
      accountName: "bg-shared-account",
      email: "brandongoodman58+shared@gmail.com", // ← must be a unique email globally
      parentIds: [bgOU.attrId],
      roleName: "OrganizationAccountAccessRole",
    });
  }
}
