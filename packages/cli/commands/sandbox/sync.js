const {
  addAccountOptions,
  addConfigOptions,
  getAccountId,
  addUseEnvironmentOptions,
  addTestingOptions,
} = require('../../lib/commonOpts');
// const { trackCommandUsage } = require('../../lib/usageTracking');
const { logger } = require('@hubspot/cli-lib/logger');
const Spinnies = require('spinnies');
const { initiateSync } = require('@hubspot/cli-lib/sandboxes');
const { loadAndValidateOptions } = require('../../lib/validation');
const { i18n } = require('@hubspot/cli-lib/lib/lang');
const { logErrorInstance } = require('@hubspot/cli-lib/errorHandlers');
const {
  debugErrorAndContext,
} = require('@hubspot/cli-lib/errorHandlers/standardErrors');
const { ENVIRONMENTS } = require('@hubspot/cli-lib/lib/constants');
const { EXIT_CODES } = require('../../lib/enums/exitCodes');
const { getAccountConfig, getConfig, getEnv } = require('@hubspot/cli-lib');
const { getHubSpotWebsiteOrigin } = require('@hubspot/cli-lib/lib/urls');
const { promptUser } = require('../../lib/prompts/promptUtils');
const { uiLine } = require('../../lib/ui');
const { getAccountName, getSyncTasks } = require('../../lib/sandboxes');

const i18nKey = 'cli.commands.sandbox.subcommands.sync';

// const pollForSyncTaskUpdates = (accountId, taskId) => {
//   return fetchTaskStatus(accountId, taskId)
//     .then(task => {
//       if (isTaskActive(task)) {
//         setTimeout(
//           () => pollForSyncTaskUpdates(accountId, taskId),
//           ACTIVE_TASK_POLL_INTERVAL
//         );
//       }
//     })
//     .catch(e => logger.error(e));
// };

exports.command = 'sync';
exports.describe = i18n(`${i18nKey}.describe`);

exports.handler = async options => {
  await loadAndValidateOptions(options);

  // const { force } = options;
  const config = getConfig();
  const accountId = getAccountId(options);
  const accountConfig = getAccountConfig(accountId);
  // const env = options.qa ? ENVIRONMENTS.QA : ENVIRONMENTS.PROD;
  const spinnies = new Spinnies({
    succeedColor: 'white',
  });

  // trackCommandUsage('sandbox-sync', null, accountId);

  if (
    accountConfig.sandboxAccountType === undefined ||
    accountConfig.sandboxAccountType === null
  ) {
    // trackCommandUsage('sandbox-sync', { successful: false }, accountId);

    logger.error(i18n(`${i18nKey}.failure.notSandbox`));

    process.exit(EXIT_CODES.ERROR);
  }

  if (accountConfig.sandboxAccountType === 'DEVELOPER') {
    logger.log(i18n(`${i18nKey}.info.developmentSandbox`));
  } else {
    // TODO: standard sandbox info log
    process.exit(EXIT_CODES.ERROR);
  }

  let parentAccountId;
  for (const portal of config.portals) {
    if (portal.portalId === accountId) {
      if (portal.parentAccountId) {
        parentAccountId = portal.parentAccountId;
      }
    }
  }

  if (!getAccountId({ account: parentAccountId })) {
    const baseUrl = getHubSpotWebsiteOrigin(
      getEnv(accountId) === 'qa' ? ENVIRONMENTS.QA : ENVIRONMENTS.PROD
    );
    const url = `${baseUrl}/sandboxes/${parentAccountId}`;
    const command = `hs auth ${
      getEnv(accountId) === 'qa' ? '--qa' : ''
    } --account=${parentAccountId}`;
    logger.log('');
    logger.error(
      i18n(`${i18nKey}.missingParentPortal`, {
        parentAccountId,
        url,
        command,
      })
    );
    logger.log('');
    process.exit(EXIT_CODES.ERROR);
  }

  const parentAccountConfig = getAccountConfig(parentAccountId);

  if (accountConfig.sandboxAccountType === 'DEVELOPER') {
    logger.log(
      i18n(`${i18nKey}.info.sync`, {
        parentAccountName: getAccountName(parentAccountConfig),
        sandboxName: getAccountName(accountConfig),
      })
    );
    uiLine();
    logger.warn(i18n(`${i18nKey}.warning`));
    uiLine();

    const { confirmSandboxSyncPrompt: confirmed } = await promptUser([
      {
        name: 'confirmSandboxSyncPrompt',
        type: 'confirm',
        message: i18n(`${i18nKey}.confirm.developmentSandbox`, {
          parentAccountName: getAccountName(parentAccountConfig),
          sandboxName: getAccountName(accountConfig),
        }),
      },
    ]);
    if (!confirmed) {
      process.exit(EXIT_CODES.SUCCESS);
    }
  } else {
    // TODO: standard sandbox info log
    process.exit(EXIT_CODES.ERROR);
  }

  try {
    spinnies.add('sandboxSync', {
      text: i18n(`${i18nKey}.loading.startSync`),
    });

    const tasks = await getSyncTasks(accountConfig);

    const result = await initiateSync(
      parentAccountId,
      accountId,
      tasks,
      accountId
    );

    logger.log(
      i18n(`${i18nKey}.info.syncStatus`, {
        url: result.links.status,
      })
    );
    logger.log('');

    if (result) {
      console.log('result: ', result);
    }

    spinnies.update('sandboxSync', {
      text: i18n(`${i18nKey}.loading.syncing`),
    });

    logger.log('');
    spinnies.succeed('sandboxSync', {
      text: i18n(`${i18nKey}.loading.succeed`),
    });
  } catch (err) {
    console.log('error with sync: ', err);
    debugErrorAndContext(err);

    // trackCommandUsage('sandbox-sync', { successful: false }, accountId);

    spinnies.fail('sandboxSync', {
      text: i18n(`${i18nKey}.loading.fail`),
    });

    // logger.error(err.error && err.error.message);
    process.exit(EXIT_CODES.ERROR);
  }
  try {
    // polling here
    console.log('it is done');
  } catch (err) {
    logErrorInstance(err);
    process.exit(EXIT_CODES.ERROR);
  }
};

exports.builder = yargs => {
  yargs.example([['$0 sandbox sync', i18n(`${i18nKey}.examples.default`)]]);

  addConfigOptions(yargs, true);
  addAccountOptions(yargs, true);
  addUseEnvironmentOptions(yargs, true);
  addTestingOptions(yargs, true);

  return yargs;
};
