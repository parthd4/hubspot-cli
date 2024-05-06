const {
  fetchPublicAppOptions,
  selectPublicAppPrompt,
} = require('./prompts/selectPublicAppPrompt');
const { EXIT_CODES } = require('./enums/exitCodes');
const { i18n } = require('./lang');
const { logger } = require('@hubspot/local-dev-lib/logger');
const {
  migrateApp,
  checkMigrationStatus,
} = require('@hubspot/local-dev-lib/api/projects');

const i18nKey = 'cli.lib.publicApps';

const fetchPublicApp = async (accountId, accountName, options, migrateApp) => {
  const { appId } = await selectPublicAppPrompt({
    accountId,
    accountName,
    options,
    migrateApp,
  });
  return appId;
};

const migratePublicApp = async (accountId, appId, name) => {
  await migrateApp(accountId, appId, name);
};

const getMigrationStatus = async (accountId, id) => {
  await checkMigrationStatus(accountId, id);
};

const clonePublicApp = async (appId, name, location) => {
  console.log('Cloning appId', appId);
  console.log('Name:', name);
  console.log('Location:', location);
  return;
};

const validateAppId = async (appId, accountId, accountName) => {
  const publicApps = await fetchPublicAppOptions(accountId, accountName);
  if (!publicApps.find(a => a.id === appId)) {
    logger.error(i18n(`${i18nKey}.errors.invalidAppId`, { appId }));
    process.exit(EXIT_CODES.ERROR);
  }
};

module.exports = {
  migratePublicApp,
  getMigrationStatus,
  clonePublicApp,
  fetchPublicApp,
  validateAppId,
};
