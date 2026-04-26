import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface RDSStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.Vpc;
  /** Tighten DB access to a specific ECS security group once the ECS stack exists. */
  ecsSecurityGroup?: ec2.ISecurityGroup;
}

export class RDSStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: RDSStackProps) {
    super(scope, id, props);

    const { cfg, vpc, ecsSecurityGroup } = props;
    const rdsCfg = cfg.rdsConfig!;

    // ── KMS Key ────────────────────────────────────────────────────────────────
    const dbKey = new kms.Key(this, "DbKey", {
      description: `${cfg.envName} RDS storage encryption key`,
      enableKeyRotation: true,
      removalPolicy: rdsCfg.removalPolicy,
    });
    new cdk.CfnOutput(this, "DbKeyArn", {
      value: dbKey.keyArn,
      description: "KMS key ARN for RDS storage encryption",
    });

    // ── Security Group ─────────────────────────────────────────────────────────
    // Prefer allowing only the ECS SG (principle of least privilege).
    // Falls back to the full VPC CIDR until the ECS stack is wired in.
    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: `${cfg.envName} RDS PostgreSQL — allow 5432 from ECS only`,
      allowAllOutbound: false,
    });

    if (ecsSecurityGroup) {
      dbSg.addIngressRule(
        ecsSecurityGroup,
        ec2.Port.tcp(5432),
        "PostgreSQL from ECS security group",
      );
    } else {
      dbSg.addIngressRule(
        ec2.Peer.ipv4(cfg.vpcCidr),
        ec2.Port.tcp(5432),
        "PostgreSQL from VPC CIDR — tighten to ECS SG once ECS stack exists",
      );
    }

    // ── Subnet Group ───────────────────────────────────────────────────────────
    // Placed in the existing PRIVATE_ISOLATED subnets — no NAT or IGW exposure.
    // Requires NetworkStack maxAzs ≥ 2 (RDS subnet groups need ≥ 2 AZs).
    const subnetGroup = new rds.SubnetGroup(this, "DbSubnetGroup", {
      vpc,
      description: `${cfg.envName} RDS subnet group`,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── RDS Instance ───────────────────────────────────────────────────────────
    this.dbInstance = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(rdsCfg.instanceClass, rdsCfg.instanceSize),
      vpc,
      subnetGroup,
      securityGroups: [dbSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },

      multiAz: rdsCfg.multiAz,
      allocatedStorage: rdsCfg.allocatedStorage,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: dbKey,

      // Credentials auto-generated and stored in Secrets Manager.
      // The SecretsManager VPC endpoint in NetworkStack handles private access.
      credentials: rds.Credentials.fromGeneratedSecret("postgres", {
        secretName: `/${cfg.envName}/rds/postgres/credentials`,
      }),
      databaseName: "appdb",

      backupRetention: cdk.Duration.days(rdsCfg.backupRetentionDays),
      deletionProtection: rdsCfg.deletionProtection,
      removalPolicy: rdsCfg.removalPolicy,

      publiclyAccessible: false,
    });

    // ── Outputs ────────────────────────────────────────────────────────────────
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
