// @ts-nocheck
const {
  MODE,
  DEFAULT_MODE,
} = require('@hubspot/local-dev-lib/constants/files');
const {
  getAndLoadConfigIfNeeded,
  getAccountId,
  getAccountConfig,
  loadConfigFromEnvironment,
} = require('@hubspot/local-dev-lib/config');
const { getMode } = require('../commonOpts');

jest.mock('@hubspot/local-dev-lib/config');
jest.mock('@hubspot/local-dev-lib/logger');

describe('lib/commonOpts', () => {
  describe('getMode()', () => {
    const accounts = {
      PROD: 123,
      DEV: 456,
    };
    const devAccountConfig = {
      accountId: accounts.DEV,
      name: 'DEV',
      defaultMode: MODE.draft,
    };
    const prodAccountConfig = {
      accountId: accounts.PROD,
      name: 'PROD',
    };
    const config = {
      defaultAccount: 'DEV',
      accounts: [devAccountConfig, prodAccountConfig],
    };
    const configWithDefaultMode = {
      ...config,
      defaultMode: MODE.draft,
    };

    afterEach(() => {
      getAndLoadConfigIfNeeded.mockReset();
      getAccountId.mockReset();
      getAccountConfig.mockReset();
      loadConfigFromEnvironment.mockReset();
    });

    describe('mode option precedence', () => {
      describe('1. --mode', () => {
        it('should return the mode specified by the command option if present.', () => {
          getAndLoadConfigIfNeeded.mockReturnValue(configWithDefaultMode);
          getAccountConfig.mockReturnValue(devAccountConfig);
          expect(getMode({ mode: MODE.draft })).toBe(MODE.draft);
          expect(getMode({ mode: MODE.publish })).toBe(MODE.publish);
          expect(getMode({ mode: 'undefined-mode' })).toBe('undefined-mode');
        });
      });
      describe('2. hubspot.config.yml -> config.accounts[x].defaultMode', () => {
        it('should return the defaultMode specified by the account specific config if present.', () => {
          getAndLoadConfigIfNeeded.mockReturnValue(configWithDefaultMode);
          getAccountId.mockReturnValue(accounts.DEV);
          getAccountConfig.mockReturnValue(devAccountConfig);
          loadConfigFromEnvironment.mockReturnValue(undefined);
          expect(getMode({ account: accounts.DEV })).toBe(MODE.draft);
        });
      });
      describe('3. hubspot.config.yml -> config.defaultMode', () => {
        it('should return the defaultMode specified by the config if present.', () => {
          getAndLoadConfigIfNeeded.mockReturnValue(configWithDefaultMode);
          getAccountId.mockReturnValue(accounts.PROD);
          getAccountConfig.mockReturnValue(prodAccountConfig);
          loadConfigFromEnvironment.mockReturnValue(undefined);
          expect(getMode({ account: accounts.PROD })).toBe(MODE.draft);
        });
      });
      describe('4. DEFAULT_MODE', () => {
        it('should return the defaultMode specified by the config if present.', () => {
          loadConfigFromEnvironment.mockReturnValue(undefined);
          expect(getMode({ account: 'xxxxx' })).toBe(DEFAULT_MODE);
        });
      });
    });
  });
});
