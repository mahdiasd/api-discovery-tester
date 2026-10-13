# مستندات وب‌سرویس‌های پروژه: {{projectName}}

- **زمان اسکن**: {{scannedAt}}
- **آدرس پایه پیش‌فرض**: `{{defaultBaseUrl}}`
- **روش احراز هویت**: `{{authMode}}` (هدر: `{{authHeader}}`)
- **تعداد وب‌سرویس‌ها**: {{totalEndpoints}}

---

## فهرست وب‌سرویس‌ها (به ترتیب اولویت وابستگی)

| ردیف | نام سرویس | متد | مسیر | سطح ریسک | وابستگی‌ها |
| :---: | :--- | :---: | :--- | :---: | :--- |
{{#endpointsTable}}
| {{executionOrder}} | {{name}} | `{{method}}` | `{{path}}` | `{{riskLevel}}` | {{dependsOnList}} |
{{/endpointsTable}}

---

## جزییات وب‌سرویس‌ها

{{#endpointsDetails}}
### {{executionOrder}}. {{name}} (`{{id}}`)

- **متد**: `{{method}}`
- **مسیر**: `{{path}}`
- **سطح ریسک**: `{{riskLevel}}`
- **پیش‌نیازها**: {{dependsOnList}}

```http
{{method}} {{path}} HTTP/1.1
{{#headers}}
{{key}}: {{value}}
{{/headers}}
```

{{#hasBody}}
**بدنه نمونه درخواست**:
```json
{{bodyJson}}
```
{{/hasBody}}

---
{{/endpointsDetails}}
