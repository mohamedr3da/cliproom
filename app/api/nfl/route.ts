const ESPN_GAME_CDN = "https://cdn.espn.com/core/nfl/game";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=5",
      ...corsHeaders,
    },
  });
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.espn.com/",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`ESPN CDN returned ${response.status}`);
  }

  return response.json();
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const eventId = url.searchParams.get("event") ?? "";

  if (!/^\d{8}$/.test(date) || !/^\d{6,15}$/.test(eventId)) {
    return json(
      {
        ok: false,
        error: "Use ?date=YYYYMMDD&event=NUMERIC_EVENT_ID",
      },
      400,
    );
  }

  try {
    const raw = await fetchJson(
      `${ESPN_GAME_CDN}?xhr=1&gameId=${encodeURIComponent(eventId)}`,
    );

    const game = raw?.gamepackageJSON ?? raw;
    const header = game?.header ?? {};

    // The existing Pogly widget expects scoreboard.events[] plus a
    // summary object. ESPN's CDN game package already contains the
    // summary-style data, and header contains the live competition state.
    const event = {
      ...header,
      id: String(header?.id ?? eventId),
      competitions: Array.isArray(header?.competitions)
        ? header.competitions
        : [],
    };

    if (!event.competitions.length) {
      return json(
        {
          ok: false,
          error: "ESPN CDN response did not contain game competition data",
        },
        502,
      );
    }

    return json({
      ok: true,
      source: "espn-cdn",
      fetchedAt: new Date().toISOString(),
      date,
      event: eventId,
      scoreboard: {
        events: [event],
      },
      summary: game,
      summaryAvailable: true,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "ESPN CDN game request failed",
        detail:
          error instanceof Error ? error.message : String(error ?? "unknown error"),
      },
      502,
    );
  }
}
