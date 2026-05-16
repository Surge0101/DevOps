import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface ECSTestStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.Vpc;
  ecsSg: ec2.SecurityGroup;
}

export class ECSTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ECSTestStackProps) {
    super(scope, id, props);

    const { cfg, vpc, ecsSg } = props;

    // ── ECR Repository (existing — created manually before this deploy) ────────
    const repo = ecr.Repository.fromRepositoryName(
      this,
      "AppRepo",
      `${cfg.envName}-spring-app`,
    );

    // ── ECS Cluster ────────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "TestCluster", {
      vpc,
      clusterName: `${cfg.envName}-test-cluster`,
    });

    // ── IAM Execution Role ─────────────────────────────────────────────────────
    const executionRole = new iam.Role(this, "TaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // ── IAM Task Role (needs SSM permissions for ECS Exec) ────────────────────
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        resources: ["*"],
      }),
    );

    // ── Log Group ──────────────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, "TestLogGroup", {
      logGroupName: `/${cfg.envName}/ecs/test`,
      retention: logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Task Definition ────────────────────────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole,
      taskRole,
    });

    taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repo, "latest"),
      portMappings: [{ containerPort: 8080 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "test",
        logGroup,
      }),
      environment: {
        SPRING_PROFILES_ACTIVE: cfg.envName,
      },
    });

    // ── Fargate Service ────────────────────────────────────────────────────────
    new ecs.FargateService(this, "TestService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: false },
      enableExecuteCommand: true,
    });

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "Run: aws ecs list-tasks --cluster <value> to confirm task is running",
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "Run: aws logs tail <value> --follow to watch container output",
    });
  }
}
