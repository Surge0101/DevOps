import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface RDSStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.Vpc;
  rdsSecurityGroup: ec2.ISecurityGroup;
}

export class RDSStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: rds.DatabaseSecret;
  public readonly dbKey: kms.Key;

  constructor(scope: Construct, id: string, props: RDSStackProps) {
    super(scope, id, props);

    const { cfg, vpc, rdsSecurityGroup } = props;
    const rdsCfg = cfg.rdsConfig!;

    const username = rdsCfg.dbUsername ?? "postgres";
    const databaseName = rdsCfg.databaseName ?? "appdb";

    // ── KMS Key ────────────────────────────────────────────────────────────────
    this.dbKey = new kms.Key(this, "DbKey", {
      description: `${cfg.envName} RDS storage encryption key`,
      alias: `alias/${cfg.envName}-rds-key`,
      enableKeyRotation: true,
      removalPolicy: rdsCfg.removalPolicy,
    });

    // ── Credentials ────────────────────────────────────────────────────────────
    // Explicit secret so other stacks (e.g. ECS) can reference this.dbSecret.
    this.dbSecret = new rds.DatabaseSecret(this, "DbSecret", {
      username,
      secretName: `/${cfg.envName}/rds/${username}/credentials`,
      encryptionKey: this.dbKey,
    });

    // ── Postgres engine version ────────────────────────────────────────────────
    const pgVersion = rdsCfg.postgresVersion
      ? rds.PostgresEngineVersion.of(
          rdsCfg.postgresVersion,
          rdsCfg.postgresVersion.split(".")[0],
        )
      : rds.PostgresEngineVersion.VER_16;

    // ── RDS Instance ───────────────────────────────────────────────────────────
    this.dbInstance = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: pgVersion }),
      instanceType: ec2.InstanceType.of(
        rdsCfg.instanceClass,
        rdsCfg.instanceSize,
      ),
      vpc,
      securityGroups: [rdsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },

      credentials: rds.Credentials.fromSecret(this.dbSecret),
      databaseName,
      instanceIdentifier: `${cfg.envName}-bg-app-db`,

      multiAz: rdsCfg.multiAz,
      allocatedStorage: rdsCfg.allocatedStorage,
      maxAllocatedStorage: rdsCfg.maxAllocatedStorage,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: this.dbKey,

      backupRetention: cdk.Duration.days(rdsCfg.backupRetentionDays),
      preferredBackupWindow: rdsCfg.backupWindow,
      preferredMaintenanceWindow: rdsCfg.maintenanceWindow,
      deletionProtection: rdsCfg.deletionProtection,
      removalPolicy: rdsCfg.removalPolicy,

      cloudwatchLogsExports: ["postgresql"],
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
    });

    // ── Snapshot on Deploy ─────────────────────────────────────────────────────
    if (rdsCfg.snapshotOnDeploy) {
      const snap = new cr.AwsCustomResource(this, "SnapshotOnDeploy", {
        onCreate: {
          service: "RDS",
          action: "createDBSnapshot",
          parameters: {
            DBInstanceIdentifier: this.dbInstance.instanceIdentifier,
            DBSnapshotIdentifier: `${cfg.envName}-bg-app-db-initial`,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${cfg.envName}-snapshot-on-deploy`,
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["rds:CreateDBSnapshot", "rds:AddTagsToResource"],
            resources: ["*"],
          }),
        ]),
      });
      snap.node.addDependency(this.dbInstance);
    }

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "DbKeyArn", {
      value: this.dbKey.keyArn,
      description: "KMS key ARN for RDS storage encryption",
    });
    new cdk.CfnOutput(this, "DbEndpoint", {
      value: this.dbInstance.dbInstanceEndpointAddress,
      description: "RDS instance hostname",
    });
    new cdk.CfnOutput(this, "DbSecretArn", {
      value: this.dbSecret.secretArn,
      description: "Secrets Manager ARN for DB credentials",
    });
  }
}
