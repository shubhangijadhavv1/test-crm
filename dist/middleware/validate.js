"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const ApiError_1 = require("../utils/ApiError");
/** Validate req[source] against a Zod schema; replaces it with the parsed value. */
function validate(schema, source = 'body') {
    return (req, _res, next) => {
        const result = schema.safeParse(req[source]);
        if (!result.success) {
            const err = result.error;
            const fields = {};
            for (const issue of err.issues)
                fields[issue.path.join('.') || '_'] = issue.message;
            return next(ApiError_1.ApiError.validation('Validation failed', fields));
        }
        // query/params are read-only getters on Express 5+, assign defensively
        ;
        req[source] = result.data;
        next();
    };
}
//# sourceMappingURL=validate.js.map