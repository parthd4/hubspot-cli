// @ts-nocheck
const { logger } = require('@hubspot/local-dev-lib/logger');
const { moveFile } = require('@hubspot/local-dev-lib/api/fileMapper');
const { isSpecifiedError } = require('@hubspot/local-dev-lib/errors/index');
const { logError, ApiErrorContext } = require('../lib/errorHandlers/index');
const {
  addConfigOptions,
  addAccountOptions,
  addUseEnvironmentOptions,
  getAccountId,
} = require('../lib/commonOpts');
const { trackCommandUsage } = require('../lib/usageTracking');
const { isPathFolder } = require('../lib/filesystem');
const { loadAndValidateOptions } = require('../lib/validation');
const { i18n } = require('../lib/lang');
const { uiBetaTag } = require('../lib/ui');

const i18nKey = 'commands.mv';

const getCorrectedDestPath = (srcPath, destPath) => {
  if (!isPathFolder(srcPath)) {
    return destPath;
  }

  // Makes sure that nested folders are moved independently
  return `${destPath}/${srcPath.split('/').pop()}`;
};

exports.command = 'mv <srcPath> <destPath>';
exports.describe = uiBetaTag(i18n(`${i18nKey}.describe`), false);

exports.handler = async options => {
  await loadAndValidateOptions(options);

  const { srcPath, destPath } = options;
  const accountId = getAccountId(options);

  trackCommandUsage('mv', null, accountId);

  try {
    await moveFile(accountId, srcPath, getCorrectedDestPath(srcPath, destPath));
    logger.success(
      i18n(`${i18nKey}.move`, {
        accountId,
        destPath,
        srcPath,
      })
    );
  } catch (error) {
    logger.error(
      i18n(`${i18nKey}.errors.moveFailed`, {
        accountId,
        destPath,
        srcPath,
      })
    );
    if (isSpecifiedError(error, { statusCode: 409 })) {
      logger.error(
        i18n(`${i18nKey}.errors.sourcePathExists`, {
          destPath,
          srcPath,
        })
      );
    } else {
      logError(
        error,
        new ApiErrorContext({
          accountId,
          srcPath,
          destPath,
        })
      );
    }
  }
};

exports.builder = yargs => {
  addConfigOptions(yargs);
  addAccountOptions(yargs);
  addUseEnvironmentOptions(yargs);
  yargs.positional('srcPath', {
    describe: 'Remote hubspot path',
    type: 'string',
  });
  yargs.positional('destPath', {
    describe: 'Remote hubspot path',
    type: 'string',
  });
  return yargs;
};
