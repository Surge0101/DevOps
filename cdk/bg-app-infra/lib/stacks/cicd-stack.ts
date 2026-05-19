import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { EnvConfig } from "../config";

interface CicdStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  service: ecs.FargateService;
  repo: ecr.Repository;
}

export class CicdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);

    const { cfg, service, repo } = props;

    // ── CodeBuild Project ─────────────────────────────────────────────
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: `${cfg.envName}-bg-app-build`,
      description: `Build and push Docker image for ${cfg.envName}-bg-app`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          ECR_URI: {
            value: repo.repositoryUri,
          },
          CONTAINER_NAME: {
            value: `${cfg.envName}-placeholder-app`,
          },
          AWS_DEFAULT_REGION: {
            value: cfg.region,
          },
        },
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        "cdk/backend-app/buildspec.yml",
      ),
      timeout: cdk.Duration.minutes(20),
    });

    repo.grantPullPush(buildProject);

    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );

    // ── Pipeline Artifacts ────────────────────────────────────────────
    const sourceOutput = new codepipeline.Artifact("SourceOutput");
    const buildOutput = new codepipeline.Artifact("BuildOutput");

    // ── CodePipeline ──────────────────────────────────────────────────
    new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `${cfg.envName}-bg-app-pipeline`,
      restartExecutionOnUpdate: true,
      stages: [
        // ── Stage 1: Source ──────────────────────────────────────────
        {
          stageName: "Source",
          actions: [
            new actions.CodeStarConnectionsSourceAction({
              actionName: "GitHub_Source",
              connectionArn: cfg.githubConnectionArn!,
              owner: cfg.githubOwner!,
              repo: cfg.githubRepo!,
              branch: cfg.githubBranch ?? "main",
              output: sourceOutput,
              triggerOnPush: true,
            }),
          ],
        },

        // ── Stage 2: Build ───────────────────────────────────────────
        {
          stageName: "Build",
          actions: [
            new actions.CodeBuildAction({
              actionName: "Build_and_Push",
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },

        // ── Stage 3: Deploy ──────────────────────────────────────────
        {
          stageName: "Deploy",
          actions: [
            new actions.EcsDeployAction({
              actionName: "Deploy_to_ECS",
              service,
              imageFile: buildOutput.atPath("imagedefinitions.json"),
              deploymentTimeout: cdk.Duration.minutes(20),
            }),
          ],
        },
      ],
    });

    // ── Tags ──────────────────────────────────────────────────────────
    cdk.Tags.of(this).add("Environment", cfg.envName);
    cdk.Tags.of(this).add("Owner", "Brandon.Goodman");
    cdk.Tags.of(this).add("Project", "bg-app");
  }
}
