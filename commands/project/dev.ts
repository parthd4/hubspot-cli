// @ts-nocheck
const {
  addAccountOptions,
  addConfigOptions,
  getAccountId,
  addUseEnvironmentOptions,
  addTestingOptions,
} = require('../../lib/commonOpts');
const { trackCommandUsage } = require('../../lib/usageTracking');
const { loadAndValidateOptions } = require('../../lib/validation');
const { handleExit } = require('../../lib/process');
const { i18n } = require('../../lib/lang');
const { logger } = require('@hubspot/local-dev-lib/logger');
const {
  getConfigAccounts,
  getAccountConfig,
  getEnv,
} = require('@hubspot/local-dev-lib/config');
const {
  getProjectConfig,
  ensureProjectExists,
  validateProjectConfig,
} = require('../../lib/projects');
const { EXIT_CODES } = require('../../lib/enums/exitCodes');
const { uiBetaTag, uiCommandReference, uiLink } = require('../../lib/ui');
const SpinniesManager = require('../../lib/ui/SpinniesManager');
const LocalDevManager = require('../../lib/LocalDevManager');
const {
  isSandbox,
  isDeveloperTestAccount,
  isStandardAccount,
  isAppDeveloperAccount,
} = require('../../lib/accountTypes');
const { getValidEnv } = require('@hubspot/local-dev-lib/environment');

const {
  findProjectComponents,
  getProjectComponentTypes,
  COMPONENT_TYPES,
} = require('../../lib/projectStructure');
const {
  confirmDefaultAccountIsTarget,
  suggestRecommendedNestedAccount,
  checkIfDefaultAccountIsSupported,
  createSandboxForLocalDev,
  createDeveloperTestAccountForLocalDev,
  createNewProjectForLocalDev,
  createInitialBuildForNewProject,
  useExistingDevTestAccount,
  checkIfAccountFlagIsSupported,
  checkIfParentAccountIsAuthed,
} = require('../../lib/localDev');

const i18nKey = 'commands.project.subcommands.dev';

exports.command = 'dev [--account]';
exports.describe = uiBetaTag(i18n(`${i18nKey}.describe`), false);

exports.handler = async options => {
  await loadAndValidateOptions(options);
  const accountId = getAccountId(options);
  const accountConfig = getAccountConfig(accountId);
  const env = getValidEnv(getEnv(accountId));

  trackCommandUsage('project-dev', null, accountId);

  const { projectConfig, projectDir } = await getProjectConfig();

  uiBetaTag(i18n(`${i18nKey}.logs.betaMessage`));

  logger.log(
    uiLink(
      i18n(`${i18nKey}.logs.learnMoreLocalDevServer`),
      'https://developers.hubspot.com/docs/platform/project-cli-commands#start-a-local-development-server'
    )
  );

  if (!projectConfig) {
    logger.error(i18n(`${i18nKey}.errors.noProjectConfig`));
    process.exit(EXIT_CODES.ERROR);
  }

  validateProjectConfig(projectConfig, projectDir);

  const components = await findProjectComponents(projectDir);
  const runnableComponents = components.filter(component => component.runnable);
  const componentTypes = getProjectComponentTypes(runnableComponents);
  const hasPrivateApps = !!componentTypes[COMPONENT_TYPES.privateApp];
  const hasPublicApps = !!componentTypes[COMPONENT_TYPES.publicApp];

  if (runnableComponents.length === 0) {
    logger.error(
      i18n(`${i18nKey}.errors.noRunnableComponents`, {
        projectDir,
        command: uiCommandReference('hs project add'),
      })
    );
    process.exit(EXIT_CODES.SUCCESS);
  } else if (hasPrivateApps && hasPublicApps) {
    logger.error(i18n(`${i18nKey}.errors.invalidProjectComponents`));
    process.exit(EXIT_CODES.SUCCESS);
  }

  const accounts = getConfigAccounts();

  const defaultAccountIsRecommendedType =
    isDeveloperTestAccount(accountConfig) ||
    (!hasPublicApps && isSandbox(accountConfig));

  // The account that the project must exist in
  let targetProjectAccountId = options.account ? accountId : null;
  // The account that we are locally testing against
  let targetTestingAccountId = options.account ? accountId : null;

  // Check that the default account or flag option is valid for the type of app in this project
  if (options.account) {
    checkIfAccountFlagIsSupported(accountConfig, hasPublicApps);

    if (hasPublicApps) {
      targetProjectAccountId = accountConfig.parentAccountId;
    }
  } else {
    checkIfDefaultAccountIsSupported(accountConfig, hasPublicApps);
  }

  // The user is targeting an account type that we recommend developing on
  if (!targetProjectAccountId && defaultAccountIsRecommendedType) {
    targetTestingAccountId = accountId;

    await confirmDefaultAccountIsTarget(accountConfig, hasPublicApps);

    if (hasPublicApps) {
      checkIfParentAccountIsAuthed(accountConfig);
      targetProjectAccountId = accountConfig.parentAccountId;
    } else {
      targetProjectAccountId = accountId;
    }
  }

  let createNewSandbox = false;
  let createNewDeveloperTestAccount = false;

  if (!targetProjectAccountId) {
    const {
      targetAccountId,
      parentAccountId,
      createNestedAccount,
      notInConfigAccount,
    } = await suggestRecommendedNestedAccount(
      accounts,
      accountConfig,
      hasPublicApps
    );

    targetProjectAccountId = hasPublicApps ? parentAccountId : targetAccountId;
    targetTestingAccountId = targetAccountId;

    // Only used for developer test accounts that are not yet in the config
    if (notInConfigAccount) {
      await useExistingDevTestAccount(env, notInConfigAccount);
    }

    createNewSandbox = isStandardAccount(accountConfig) && createNestedAccount;
    createNewDeveloperTestAccount =
      isAppDeveloperAccount(accountConfig) && createNestedAccount;
  }

  if (createNewSandbox) {
    targetProjectAccountId = await createSandboxForLocalDev(
      accountId,
      accountConfig,
      env
    );
    // We will be running our tests against this new sandbox account
    targetTestingAccountId = targetProjectAccountId;
  }
  if (createNewDeveloperTestAccount) {
    targetTestingAccountId = await createDeveloperTestAccountForLocalDev(
      accountId,
      accountConfig,
      env
    );
    targetProjectAccountId = accountId;
  }

  // eslint-disable-next-line prefer-const
  let { projectExists, project } = await ensureProjectExists(
    targetProjectAccountId,
    projectConfig.name,
    {
      allowCreate: false,
      noLogs: true,
      withPolling: createNewSandbox,
    }
  );

  let deployedBuild;
  let isGithubLinked;

  SpinniesManager.init();

  if (projectExists) {
    deployedBuild = project.deployedBuild;
    isGithubLinked =
      project.sourceIntegration &&
      project.sourceIntegration.source === 'GITHUB';
  } else {
    project = await createNewProjectForLocalDev(
      projectConfig,
      targetProjectAccountId,
      createNewSandbox,
      hasPublicApps
    );

    deployedBuild = await createInitialBuildForNewProject(
      projectConfig,
      projectDir,
      targetProjectAccountId
    );
  }

  const LocalDev = new LocalDevManager({
    runnableComponents,
    debug: options.debug,
    deployedBuild,
    isGithubLinked,
    parentAccountId: targetProjectAccountId,
    projectConfig,
    projectDir,
    projectId: project.id,
    targetAccountId: targetTestingAccountId,
    env,
  });

  await LocalDev.start();

  handleExit(({ isSIGHUP }) => LocalDev.stop(!isSIGHUP));
};

exports.builder = yargs => {
  addConfigOptions(yargs);
  addAccountOptions(yargs);
  addUseEnvironmentOptions(yargs);
  addTestingOptions(yargs);

  yargs.example([['$0 project dev', i18n(`${i18nKey}.examples.default`)]]);

  return yargs;
};
