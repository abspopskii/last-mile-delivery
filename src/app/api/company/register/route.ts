import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { verifyFirebaseToken } from "@/lib/firebase-admin";
import type { Company, UserRecord } from "@/lib/types";
import { createAuditEvent } from "@/lib/audit";

/**
 * POST /api/company/register
 *
 * Creates a Company record + UserRecord (company_admin) for the authenticated user.
 * Writes a lightweight company and user record for the authenticated account.
 * Idempotent: if user already has a company, returns it.
 */
export async function POST(req: NextRequest) {
  let userId: string;
  let userEmail: string | undefined;

  try {
    const verified = await verifyFirebaseToken(req);
    userId = verified.uid;
    // Get user email from Firebase token claims if available
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.slice(7).trim();
    try {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
      userEmail = payload.email as string | undefined;
    } catch { /* non-fatal */ }
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const companyType = typeof body.companyType === "string" ? body.companyType.trim() : "";
  const operatingStates = Array.isArray(body.operatingStates)
    ? body.operatingStates.filter((state): state is string => typeof state === "string" && state.trim().length > 0)
    : [];
  if (!companyName || !companyType || operatingStates.length === 0) {
    return NextResponse.json(
      { error: "Company name, operation, and operating state are required." },
      { status: 400 }
    );
  }

  try {
    const db = await getDb();

    // Idempotency check
    const existing = await db.collection<UserRecord>("users").findOne({ userId });
    if (existing?.companyId) {
      await db.collection<Company>("companies").updateOne(
        { companyId: existing.companyId, status: "pending" },
        { $set: { status: "approved" } }
      );
      const co = await db.collection<Company>("companies").findOne({ companyId: existing.companyId });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id: _a, ...ur } = existing as typeof existing & { _id: unknown };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id: _b, ...coClean } = (co ?? {}) as Record<string, unknown>;
      return NextResponse.json({ userRecord: ur, company: coClean }, { status: 200 });
    }

    const now = new Date().toISOString();
    const companyId = `co-${crypto.randomUUID()}`;
    const email = userEmail || (typeof body.email === "string" ? body.email.trim() : "");
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const address = typeof body.address === "string" && body.address.trim()
      ? body.address.trim()
      : `${operatingStates[0]}, Nigeria`;
    const companyRegistrationNumber = typeof body.companyRegistrationNumber === "string"
      ? body.companyRegistrationNumber.trim()
      : "";
    const taxIdentificationNumber = typeof body.taxIdentificationNumber === "string"
      ? body.taxIdentificationNumber.trim()
      : "";
    const fleetSize = Number(body.fleetSize ?? 1);

    const company: Company = {
      companyId,
      companyName,
      companyType,
      ...(companyRegistrationNumber ? { companyRegistrationNumber } : {}),
      ...(taxIdentificationNumber ? { taxIdentificationNumber } : {}),
      website:         typeof body.website === "string" ? body.website.trim() : "",
      email,
      phone,
      address,
      fleetSize:       Number.isFinite(fleetSize) && fleetSize > 0 ? fleetSize : 1,
      operatingStates,
      cargoCategories: Array.isArray(body.cargoCategories)
        ? body.cargoCategories.filter((category): category is string => typeof category === "string")
        : [],
      status:          "approved",
      // Trust metrics - initialized to defaults
      trustScore:         100,
      completedShipments: 0,
      delayedShipments:   0,
      incidentCount:      0,
      auditFlags:         0,
      // Multilingual defaults
      preferredLanguage:  "en",
      supportedLanguages: ["en"],
      fallbackLanguage:   "en",
      createdAt:       now,
    };

    const userRecord: UserRecord = {
      userId,
      companyId,
      name:      String(body.contactName ?? userEmail ?? userId),
      email,
      role:      "company_admin",
      active:    true,
      createdAt: now,
    };



    await db.collection("companies").insertOne(company);
    await db.collection("users").insertOne(userRecord);

    // Audit is useful but should not block a lightweight first-time setup.
    await createAuditEvent({
      db,
      companyId,
      eventType:   "company_registered",
      performedBy: userId,
      description: `Company "${company.companyName}" registered. Status: approved.`,
      details:     { companyName: company.companyName, companyType: company.companyType },
    });

    return NextResponse.json({ userRecord, company }, { status: 201 });
  } catch (err) {
    console.log("[POST /api/company/register]", err);
    const detail = process.env.NODE_ENV === "development" && err instanceof Error
      ? ` (${err.message})`
      : "";
    return NextResponse.json(
      { error: `Failed to register company${detail}` },
      { status: 500 }
    );
  }
}
