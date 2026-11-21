/**
 * Static HTML storefront on Vercel, with optional same-origin HTTPS API proxy.
 * In Vercel set Project Root Directory = nothing-coffee and Framework = Other.
 * Production requires the public HTTPS backend's origin URL.
 */
const backend = (process.env.MARKETPLACE_BACKEND_ORIGIN || "").trim();
function checkedOrigin(input) {
  if (!input) return null;
  let value;
  try { value = new URL(input); }
  catch { throw new Error("MARKETPLACE_BACKEND_ORIGIN must be a valid HTTPS origin"); }
  if (value.protocol !== "https:" || !value.hostname ||
      value.username || value.password ||
      value.pathname !== "/" || value.search || value.hash ||
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(value.hostname.toLowerCase())) {
    throw new Error("MARKETPLACE_BACKEND_ORIGIN must be a PUBLIC HTTPS origin without path, credentials or query");
  }
  return value.origin;
}
const origin = checkedOrigin(backend);
if (!origin && process.env.VERCEL_ENV === "production") {
  throw new Error("Production storefront needs MARKETPLACE_BACKEND_ORIGIN pointing to your live HTTPS Spring Boot backend");
}
export const config = {
  framework: null,
  rewrites: origin ? [
    { source: "/api/:path*", destination: `${origin}/api/:path*` },
    { source: "/images/:path*", destination: `${origin}/images/:path*` },
  ] : [],
  headers: [
    {source:"/api/:path*",headers:[{key:"Cache-Control",value:"no-store"},
                                  {key:"X-Content-Type-Options",value:"nosniff"}]},
    {source:"/index.html",headers:[{key:"Cache-Control",value:"no-store"}]},
    {source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},
                                {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"}]},
  ],
};
