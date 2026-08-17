// Request-body validation.
//
// Every POST body goes through a zod schema. Routes read req.valid, never
// req.body, so an unvalidated field cannot reach a model by accident.

/**
 * @param {import('zod').ZodSchema} schema
 * @param {{onError?: (req, res, errors) => void}} [options]
 */
export function validate(schema, { onError } = {}) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (result.success) {
      req.valid = result.data;
      return next();
    }

    // { fieldName: "message" } — enough for a form to render inline errors.
    const errors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!errors[key]) errors[key] = issue.message;
    }

    if (onError) return onError(req, res, errors);

    res.status(400);
    return res.render('error.njk', {
      title: 'Invalid submission',
      heading: 'That form could not be accepted',
      message: Object.entries(errors)
        .map(([field, message]) => `${field}: ${message}`)
        .join('. '),
      status: 400,
    });
  };
}

/**
 * Re-render a form with the submitted values and inline errors instead of
 * throwing the customer out to an error page.
 * @param {string} view
 * @param {(req) => object} [extraLocals]
 */
export function reRenderOnError(view, extraLocals = () => ({})) {
  return async (req, res, errors) => {
    res.status(400).render(view, {
      ...(await extraLocals(req)),
      errors,
      values: req.body ?? {},
    });
  };
}
