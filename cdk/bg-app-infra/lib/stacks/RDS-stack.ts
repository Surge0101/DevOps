import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface RDSStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.Vpc;
  rdsSecurityGroup: ec2.ISecurityGroup;
}

export class RDSStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: RDSStackProps) {
    super(scope, id, props);

    const { cfg, vpc, rdsSecurityGroup } = props;
    const rdsCfg = cfg.rdsConfig!;

    // ── KMS Key ────────────────────────────────────────────────────────────────
    const dbKey = new kms.Key(this, "DbKey", {
      description: `${cfg.envName} RDS storage encryption key`,
      enableKeyRotation: true,
      removalPolicy: rdsCfg.removalPolicy,
    });

    // ── RDS Instance ───────────────────────────────────────────────────────────
    this.dbInstance = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        //Add to config template for reuseablity
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        rdsCfg.instanceClass,
        rdsCfg.instanceSize,
      ),
      vpc,
      //subnetGroup,
      securityGroups: [rdsSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },

      multiAz: rdsCfg.multiAz,
      allocatedStorage: rdsCfg.allocatedStorage,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: dbKey,

      // Credentials auto-generated and stored in Secrets Manager.
      // The SecretsManager VPC endpoint in NetworkStack handles private access.
      //Change for reuseablity case
      credentials: rds.Credentials.fromGeneratedSecret("postgres", {
        secretName: `/${cfg.envName}/rds/postgres/credentials`,
      }),
      databaseName: "appdb",

      backupRetention: cdk.Duration.days(rdsCfg.backupRetentionDays),
      deletionProtection: rdsCfg.deletionProtection,
      removalPolicy: rdsCfg.removalPolicy,

      publiclyAccessible: false,
    });
    // Set up snapshots_____________________

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "DbKeyArn", {
      value: dbKey.keyArn,
      description: "KMS key ARN for RDS storage encryption",
    });

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: this.dbInstance.dbInstanceEndpointAddress,
      description: "RDS instance hostname",
    });
    new cdk.CfnOutput(this, "DbSecretArn", {
      value: this.dbInstance.secret!.secretArn,
      description: "Secrets Manager ARN for DB credentials",
    });
  }
}
