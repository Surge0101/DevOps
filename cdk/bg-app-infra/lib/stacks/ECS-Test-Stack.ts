import * as path from "path";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
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
  public readonly fargateService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ECSTestStackProps) {
    super(scope, id, props);

    const { cfg, vpc, ecsSg } = props;

    // ── ECR Repository ─────────────────────────────────────────────────────────
    const repo = new ecr.Repository(this, "AppRepo", {
      repositoryName: `${cfg.envName}-placeholder-app`,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [{ maxImageCount: 10, description: "Keep last 10 images" }],
    });

    // ── Docker Image Asset — built & pushed on every cdk deploy ────────────────
    const image = new ecrAssets.DockerImageAsset(this, "PlaceholderImage", {
      directory: path.join(__dirname, "../../../../placeholder-app"),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // ── ECS Cluster ────────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, "TestCluster", {
      vpc,
      clusterName: `${cfg.envName}-test-cluster`,
      containerInsights: true,
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
      cpu: cfg.ecsCpu,
      memoryLimitMiB: cfg.ecsMemory,
      family: `${cfg.envName}-placeholder-app`,
      executionRole,
      taskRole,
    });

    taskDef.addContainer("AppContainer", {
      containerName: `${cfg.envName}-placeholder-app`,
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      portMappings: [{ containerPort: cfg.ecsAppPort }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `${cfg.envName}-placeholder`,
        logGroup,
      }),
      environment: {
        SPRING_PROFILES_ACTIVE: cfg.envName,
      },
      healthCheck: {
        command: ["CMD-SHELL", `curl -f http://localhost:${cfg.ecsAppPort}/health || exit 1`],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // ── Fargate Service ────────────────────────────────────────────────────────
    this.fargateService = new ecs.FargateService(this, "TestService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: cfg.ecsMinTasks,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: false },
      enableExecuteCommand: true,
    });

    // ── Tags ───────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add("Environment", cfg.envName);
    cdk.Tags.of(this).add("Owner", "Brandon.Goodman");
    cdk.Tags.of(this).add("Project", "bg-app");

    // ── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "Run: aws ecs list-tasks --cluster <value> to confirm task is running",
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "Run: aws logs tail <value> --follow to watch container output",
    });

    new cdk.CfnOutput(this, "DevEcrRepoUri", {
      value: repo.repositoryUri,
      description: "Push your app image here: docker build -t <value>:latest . && docker push <value>:latest",
    });
  }
}
