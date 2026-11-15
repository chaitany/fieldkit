import { z } from "zod";
import type { TargetSchema } from "../types";

/**
 * The product's canonical Contact model. In a real deployment this is generated from the
 * product's API/OpenAPI spec so the onboarding tool can never drift from what the API accepts.
 */
export const contactTarget: TargetSchema = {
  id: "contact",
  label: "CRM Contact",
  fields: [
    { name: "external_id", description: "Stable ID from the customer's system, used for idempotent upserts", required: true, type: "string", aliases: ["id", "customer id", "cust id", "record id", "contact id", "acct no", "account number"] },
    { name: "first_name", description: "Given name", required: true, type: "string", aliases: ["first", "fname", "given name", "forename"] },
    { name: "last_name", description: "Family name", required: true, type: "string", aliases: ["last", "lname", "surname", "family name"] },
    { name: "email", description: "Primary email address", required: true, type: "email", aliases: ["e-mail", "email address", "mail", "primary email"] },
    { name: "phone", description: "Phone in E.164 format", required: false, type: "phone", aliases: ["telephone", "tel", "mobile", "cell", "phone number", "contact no"] },
    { name: "company", description: "Employer / account name", required: false, type: "string", aliases: ["organization", "organisation", "employer", "account", "company name", "org"] },
    { name: "lifecycle_stage", description: "One of: lead, prospect, customer, churned", required: true, type: "string", aliases: ["status", "stage", "lifecycle", "customer status", "type"] },
    { name: "annual_revenue", description: "Annual contract value in USD", required: false, type: "number", aliases: ["revenue", "arr", "acv", "contract value", "amount"] },
    { name: "created_at", description: "When the contact was created (ISO 8601)", required: false, type: "date", aliases: ["created", "date added", "signup date", "created date", "since"] },
  ],
  validator: z.object({
    external_id: z.string().min(1),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().regex(/^\+\d{8,15}$/, "must be E.164, e.g. +14155550123").optional(),
    company: z.string().optional(),
    lifecycle_stage: z.enum(["lead", "prospect", "customer", "churned"]),
    annual_revenue: z.number().nonnegative().optional(),
    created_at: z.string().datetime().optional(),
  }),
};
