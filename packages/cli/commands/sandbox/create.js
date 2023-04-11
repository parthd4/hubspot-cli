const {
  addAccountOptions,
  addConfigOptions,
  getAccountId,
  addUseEnvironmentOptions,
  addTestingOptions,
} = require('../../lib/commonOpts');
const { loadAndValidateOptions } = require('../../lib/validation');
const { i18n } = require('@hubspot/cli-lib/lib/lang');
const { ENVIRONMENTS } = require('@hubspot/cli-lib/lib/constants');
const { EXIT_CODES } = require('../../lib/enums/exitCodes');
const { getAccountConfig } = require('@hubspot/cli-lib');
const { buildSandbox } = require('../../lib/sandbox-create');

const i18nKey = 'cli.commands.sandbox.subcommands.create';

exports.command = 'create [--name]';
exports.describe = i18n(`${i18nKey}.describe`);

exports.handler = async options => {
  await loadAndValidateOptions(options);

  const { name, type } = options;
  const accountId = getAccountId(options);
  const accountConfig = getAccountConfig(accountId);
  const env = options.qa ? ENVIRONMENTS.QA : ENVIRONMENTS.PROD;

  try {
    await buildSandbox({
      name,
      type,
      accountConfig,
      env,
    });
  } catch (error) {
    // Errors are logged in buildSandbox
    process.exit(EXIT_CODES.ERROR);
  }
};

exports.builder = yargs => {
  yargs.option('name', {
    describe: i18n(`${i18nKey}.options.name.describe`),
    type: 'string',
  });
  yargs.option('type', {
    describe: i18n(`${i18nKey}.options.type.describe`),
    type: 'string',
  });

  yargs.example([
    [
      '$0 sandbox create --name=MySandboxAccount',
      i18n(`${i18nKey}.examples.default`),
    ],
  ]);

  addConfigOptions(yargs, true);
  addAccountOptions(yargs, true);
  addUseEnvironmentOptions(yargs, true);
  addTestingOptions(yargs, true);

  return yargs;
};
