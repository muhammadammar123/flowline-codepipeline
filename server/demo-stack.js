// CloudFormation template for the Demo Lab pipeline:
//   Source (S3) → Build & Test (CodeBuild) → Approve (Manual) → Deploy (S3)
// The source bucket is created by Flowline before the stack, so the
// pipeline's automatic first run already has a source.zip to pick up.

export const DEMO_STACK_NAME = 'flowline-demo';
export const DEMO_PIPELINE_NAME = 'flowline-demo-pipeline';
export const SOURCE_KEY = 'source.zip';

export function demoTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Flowline Demo Lab: S3 → CodeBuild → Manual approval → S3 deploy',
    Parameters: {
      SourceBucketName: { Type: 'String' },
    },
    Resources: {
      ArtifactBucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          LifecycleConfiguration: { Rules: [{ Status: 'Enabled', ExpirationInDays: 7 }] },
        },
      },
      SiteBucket: { Type: 'AWS::S3::Bucket' },
      BuildLogGroup: {
        Type: 'AWS::Logs::LogGroup',
        Properties: { LogGroupName: '/flowline/demo-build', RetentionInDays: 7 },
      },
      BuildRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'codebuild.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          Policies: [
            {
              PolicyName: 'build',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: { 'Fn::Sub': '${BuildLogGroup.Arn}' } },
                  { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: { 'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/flowline/demo-build:*' } },
                  { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], Resource: { 'Fn::Sub': '${ArtifactBucket.Arn}/*' } },
                ],
              },
            },
          ],
        },
      },
      PipelineRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'codepipeline.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          Policies: [
            {
              PolicyName: 'pipeline',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:GetBucketVersioning', 's3:PutObject', 's3:PutObjectAcl', 's3:ListBucket', 's3:GetBucketLocation'],
                    Resource: [
                      { 'Fn::Sub': '${ArtifactBucket.Arn}' },
                      { 'Fn::Sub': '${ArtifactBucket.Arn}/*' },
                      { 'Fn::Sub': '${SiteBucket.Arn}' },
                      { 'Fn::Sub': '${SiteBucket.Arn}/*' },
                      { 'Fn::Sub': 'arn:${AWS::Partition}:s3:::${SourceBucketName}' },
                      { 'Fn::Sub': 'arn:${AWS::Partition}:s3:::${SourceBucketName}/*' },
                    ],
                  },
                  { Effect: 'Allow', Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'], Resource: { 'Fn::GetAtt': ['BuildProject', 'Arn'] } },
                ],
              },
            },
          ],
        },
      },
      BuildProject: {
        Type: 'AWS::CodeBuild::Project',
        Properties: {
          Name: 'flowline-demo-build',
          Description: 'Runs tests and renders the release page',
          ServiceRole: { 'Fn::GetAtt': ['BuildRole', 'Arn'] },
          Source: { Type: 'CODEPIPELINE' },
          Artifacts: { Type: 'CODEPIPELINE' },
          Environment: {
            Type: 'LINUX_CONTAINER',
            ComputeType: 'BUILD_GENERAL1_SMALL',
            Image: 'aws/codebuild/amazonlinux2-x86_64-standard:5.0',
          },
          LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: { Ref: 'BuildLogGroup' } } },
          TimeoutInMinutes: 10,
        },
      },
      Pipeline: {
        Type: 'AWS::CodePipeline::Pipeline',
        Properties: {
          Name: DEMO_PIPELINE_NAME,
          PipelineType: 'V2',
          ExecutionMode: 'SUPERSEDED',
          RoleArn: { 'Fn::GetAtt': ['PipelineRole', 'Arn'] },
          ArtifactStore: { Type: 'S3', Location: { Ref: 'ArtifactBucket' } },
          Stages: [
            {
              Name: 'Source',
              Actions: [
                {
                  Name: 'Checkout',
                  ActionTypeId: { Category: 'Source', Owner: 'AWS', Provider: 'S3', Version: '1' },
                  Configuration: { S3Bucket: { Ref: 'SourceBucketName' }, S3ObjectKey: SOURCE_KEY, PollForSourceChanges: 'false' },
                  OutputArtifacts: [{ Name: 'SourceOutput' }],
                  RunOrder: 1,
                },
              ],
            },
            {
              Name: 'Build',
              Actions: [
                {
                  Name: 'TestAndBuild',
                  ActionTypeId: { Category: 'Build', Owner: 'AWS', Provider: 'CodeBuild', Version: '1' },
                  Configuration: { ProjectName: { Ref: 'BuildProject' } },
                  InputArtifacts: [{ Name: 'SourceOutput' }],
                  OutputArtifacts: [{ Name: 'BuildOutput' }],
                  RunOrder: 1,
                },
              ],
            },
            {
              Name: 'Approve',
              Actions: [
                {
                  Name: 'ReleaseGate',
                  ActionTypeId: { Category: 'Approval', Owner: 'AWS', Provider: 'Manual', Version: '1' },
                  Configuration: { CustomData: 'Check the build output, then approve the release to production.' },
                  RunOrder: 1,
                },
              ],
            },
            {
              Name: 'Deploy',
              Actions: [
                {
                  Name: 'PublishSite',
                  ActionTypeId: { Category: 'Deploy', Owner: 'AWS', Provider: 'S3', Version: '1' },
                  Configuration: { BucketName: { Ref: 'SiteBucket' }, Extract: 'true' },
                  InputArtifacts: [{ Name: 'BuildOutput' }],
                  RunOrder: 1,
                },
              ],
            },
          ],
        },
      },
    },
    Outputs: {
      PipelineName: { Value: { Ref: 'Pipeline' } },
      ArtifactBucket: { Value: { Ref: 'ArtifactBucket' } },
      SiteBucket: { Value: { Ref: 'SiteBucket' } },
      BuildProject: { Value: { Ref: 'BuildProject' } },
    },
  };
}
