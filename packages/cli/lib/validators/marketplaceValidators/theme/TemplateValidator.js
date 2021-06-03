const path = require('path');

const {
  ANNOTATION_KEYS,
  getAnnotationValue,
  getFileAnnotations,
  isCodedFile,
} = require('@hubspot/cli-lib/templates');
const BaseValidator = require('../BaseValidator');

const TEMPLATE_LIMIT = 50;
const TEMPLATE_COUNT_IGNORE_LIST = ['global_partial', 'none'];
const VALIDATIONS_BY_TYPE = {
  page: { allowed: true, label: true, screenshot: true },
  starter_landing_pages: { allowed: false },
  email: { allowed: false },
  blog: { allowed: false },
  none: { allowed: true, label: false, screenshot: false },
  error_page: { allowed: true, label: true, screenshot: false },
  password_prompt_page: { allowed: true, label: true, screenshot: false },
  email_subscription_preferences_page: {
    allowed: true,
    label: true,
    screenshot: false,
  },
  email_backup_unsubscribe_page: {
    allowed: true,
    label: true,
    screenshot: false,
  },
  email_subscriptions_confirmation_page: {
    allowed: true,
    label: true,
    screenshot: false,
  },
  search_results_page: { allowed: true, label: true, screenshot: false },
  membership_login_page: { allowed: true, label: true, screenshot: false },
  membership_register_page: { allowed: true, label: true, screenshot: false },
  membership_reset_page: { allowed: true, label: true, screenshot: false },
  membership_reset_request_page: {
    allowed: true,
    label: true,
    screenshot: false,
  },
  membership_email_page: { allowed: true, label: true, screenshot: false },
  global_partial: { allowed: true, label: true, screenshot: false },
  knowledge_article: { allowed: false },
  drag_drop_email: { allowed: false },
  proposal: { allowed: false },
  blog_listing: { allowed: true, label: true, screenshot: true },
  blog_post: { allowed: true, label: true, screenshot: true },
};

class TemplateValidator extends BaseValidator {
  constructor(options) {
    super(options);

    this.errors = {
      LIMIT_EXCEEDED: {
        key: 'limitExceeded',
        getCopy: ({ limit, total }) =>
          `Cannot exceed ${limit} templates in your theme (found ${total})`,
      },
      MISSING_TEMPLATE_TYPE: {
        key: 'missingTemplateType',
        getCopy: ({ templatePath }) =>
          `Missing template type for ${templatePath}`,
      },
      UNKNOWN_TEMPLATE_TYPE: {
        key: 'unknownTemplateType',
        getCopy: ({ templatePath, templateType }) =>
          `Unknown template type ${templateType} for ${templatePath}`,
      },
      RESTRICTED_TEMPLATE_TYPE: {
        key: 'restrictedTemplateType',
        getCopy: ({ templatePath, templateType }) =>
          `Cannot have template type ${templateType} for ${templatePath}`,
      },
      MISSING_LABEL: {
        key: 'missingLabel',
        getCopy: ({ templatePath }) =>
          `Missing a "label" annotation in ${templatePath}`,
      },
      MISSING_SCREENSHOT_PATH: {
        key: 'missingScreenshotPath',
        getCopy: ({ templatePath }) =>
          `The screenshotPath is missing in ${templatePath}`,
      },
    };
  }

  // Validates:
  // - Theme does not contain more than TEMPLATE_LIMIT templates
  // - All templates have valid template types
  // - All templates that require a label have a "label" annotation
  // - All templates that require a screenshot have a "screenshotPath" annotation
  validate(absoluteThemePath, files) {
    let validationErrors = [];
    let templateCount = 0;

    files.forEach(filePath => {
      if (isCodedFile(filePath)) {
        const annotations = getFileAnnotations(filePath);
        const isAvailableForNewContent = getAnnotationValue(
          annotations,
          ANNOTATION_KEYS.isAvailableForNewContent
        );

        if (isAvailableForNewContent !== 'false') {
          const templateType = getAnnotationValue(
            annotations,
            ANNOTATION_KEYS.templateType
          );
          if (templateType) {
            const label = getAnnotationValue(
              annotations,
              ANNOTATION_KEYS.label
            );
            const screenshotPath = getAnnotationValue(
              annotations,
              ANNOTATION_KEYS.screenshotPath
            );

            // Ignore global partials and templates with type of none in count
            if (!TEMPLATE_COUNT_IGNORE_LIST.includes(templateType)) {
              templateCount++;
            }

            const validations = VALIDATIONS_BY_TYPE[templateType];

            if (validations) {
              if (!validations.allowed) {
                validationErrors.push(
                  this.getError(this.errors.RESTRICTED_TEMPLATE_TYPE, {
                    templatePath: path.relative(absoluteThemePath, filePath),
                    templateType,
                  })
                );
              }
              if (validations.label && !label) {
                validationErrors.push(
                  this.getError(this.errors.MISSING_LABEL, {
                    templatePath: path.relative(absoluteThemePath, filePath),
                  })
                );
              }
              if (validations.screenshot && !screenshotPath) {
                validationErrors.push(
                  this.getError(this.errors.MISSING_SCREENSHOT_PATH, {
                    templatePath: path.relative(absoluteThemePath, filePath),
                  })
                );
              }
            } else {
              validationErrors.push(
                this.getError(this.errors.UNKNOWN_TEMPLATE_TYPE, {
                  templatePath: path.relative(absoluteThemePath, filePath),
                  templateType,
                })
              );
            }
          } else {
            validationErrors.push(
              this.getError(this.errors.MISSING_TEMPLATE_TYPE, {
                templatePath: path.relative(absoluteThemePath, filePath),
              })
            );
          }
        }
      }
    });

    if (templateCount > TEMPLATE_LIMIT) {
      validationErrors.push(
        this.getError(this.errors.LIMIT_EXCEEDED, {
          limit: TEMPLATE_LIMIT,
          total: templateCount,
        })
      );
    }

    return validationErrors;
  }
}

module.exports = new TemplateValidator({
  name: 'Template',
  key: 'template',
});