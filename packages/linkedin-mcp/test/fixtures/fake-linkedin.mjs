// Preloaded into the setup script's own process (node --import) so its fetch
// calls reach a fake LinkedIn instead of the network. Configured through
// $FAKE_LINKEDIN. Any other host fails loudly.

const cfg = JSON.parse(process.env.FAKE_LINKEDIN);

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status });

  if (url.pathname === '/oauth/v2/accessToken') {
    if (cfg.tokenStatus)
      return json(
        { error: 'invalid_request', submitted: { code: 'fake-code' } },
        cfg.tokenStatus,
      );
    return json({
      access_token: 'fake-access-token',
      expires_in: 5184000,
      refresh_token: 'fake-refresh-token',
      refresh_token_expires_in: 31536000,
      scope: cfg.grantedScope,
    });
  }
  if (url.pathname === '/rest/organizationAcls') {
    return json({
      elements: cfg.organizations.map((organization) => ({
        organization,
        role: 'ADMINISTRATOR',
        state: 'APPROVED',
      })),
    });
  }
  if (url.pathname.startsWith('/rest/organizations/')) {
    return json({ localizedName: `Page ${url.pathname.split('/').pop()}` });
  }
  throw new Error(`unexpected fetch in setup test: ${url}`);
};
