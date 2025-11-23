let warnedMissingSecret = false;
export function hcaptchaVerify(opts = {}) {
    const bodyField = opts.bodyField ?? "hcaptcha_token";
    const configuredSecret = opts.secret ?? process.env.HCAPTCHA_SECRET_KEY;
    if (!configuredSecret && !warnedMissingSecret) {
        console.warn("hcaptchaVerify: HCAPTCHA_SECRET_KEY not set");
        warnedMissingSecret = true;
    }
    return async (c, next) => {
        const secret = configuredSecret || process.env.HCAPTCHA_SECRET_KEY;
        if (!secret)
            return c.json({ error: "Captcha misconfigured" }, 500);
        let body = c.get("jsonBody");
        if (!body) {
            try {
                body = await c.req.json();
                c.set("jsonBody", body);
            }
            catch {
                body = {};
            }
        }
        let token = body?.[bodyField] ||
            body?.["h-captcha-response"] ||
            c.req.header("h-captcha-response") ||
            c.req.header("x-hcaptcha-token");
        if (!token)
            return c.json({ error: "Captcha required" }, 400);
        const form = new URLSearchParams();
        form.set("secret", secret);
        form.set("response", token);
        const resp = await fetch("https://hcaptcha.com/siteverify", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
        }).then((r) => r.json());
        if (!resp.success) {
            return c.json({ error: "Captcha failed", codes: resp["error-codes"] ?? [] }, 400);
        }
        await next();
    };
}
