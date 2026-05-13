# Glenwood Springs — Economic Research Dashboard

An interactive dark-mode dashboard for economic research on Glenwood Springs and the broader Roaring Fork Valley — 11 anchor communities from De Beque to Aspen, plus Meeker on the Hwy 13 corridor. Bundles 22-year commute flows, demographics, housing, commerce, labor, and tourism into one static site so City staff, partner agencies, and the public can explore the same numbers without spreadsheets or API calls.

Built by the City of Glenwood Springs Economic Development office. Fully static (Vite build output) — no servers, no API keys at runtime.

## What's in the dashboard

- **Commute Flows** — LEHD LODES8 origin–destination flows for 11 anchor workplace ZIPs, routed onto a hand-authored corridor graph (Hwy 82, I-70, the Snowmass spur, Hwy 13, gateway approaches). Filterable by age, earnings, or NAICS-3 super-sector.
- **Workforce** — RAC/WAC totals plus a 20-sector NAICS breakdown and 22-year demographic trends (age, wage, race, ethnicity, education, sex) per anchor ZIP.
- **Demographics** — population, age, race, ethnicity, households, median income — Census ACS + PEP + Decennial + CO SDO historical series back to 1870.
- **Housing** — tenure, vacancy, median home value, median rent, cost burden, building permits, Fair Market Rent, Zillow ZHVI/ZORI, decennial housing counts 1970→2020.
- **Commerce** — establishment counts and employment by NAICS-2 (CBP/ZBP), municipal sales tax distributions (CDOR + home-rule cities), lodging tax.
- **Economic Research** — county GDP, per-capita income, employment by industry (BEA REIS), occupational wage statistics (CDLE OEWS), Consumer Expenditure Survey income/tax/spending by age (BLS CEX Table 1300).
- **Tourism** — airport enplanements (BTS), RFTA ridership, lodging tax distributions, visitor-profile metrics.

## Data sources

All sources are public. Build-time fetchers pull each into `data/context-cache/{…}/` and `public/data/*.json`. The runtime dashboard never calls an API.

### Workforce & commuting

| Source | Coverage | Vintage | Notes |
|---|---|---|---|
| **U.S. Census LEHD LODES8** — OD, RAC, WAC | Colorado, all blocks; filtered to 11 anchor ZIPs | 2002–2023, vintage 8.4, JT00 (All Jobs) | Bulk download from `lehd.ces.census.gov/data/lodes/LODES8/co/`. No API key. Annual release (typically October). |

### Geography

| Source | Coverage | Vintage | Notes |
|---|---|---|---|
| **U.S. Census TIGER ZCTA Gazetteer** | National ZCTA centroids | 2024 | Used for ZIP centroids; 11 anchor centroids overridden with city-center coords. |

### Demographics & population

| Source | Coverage | Vintage | API key |
|---|---|---|---|
| **Census ACS 5-Year** (B01001, B01002, B02001, B03002, B11001, B19013) | State / county / place / ZCTA | 2010–2023 | `CENSUS_API_KEY` |
| **Census PEP** — Annual Population Estimates | State / county / place | 2020+ | `CENSUS_API_KEY` |
| **Census Decennial 2020 PL/DHC** | State / county / place | 2020 | `CENSUS_API_KEY` |
| **Census decennial static counts** — historical | Colorado state, anchor counties | 1950–2020 (state), 1990–2020 (county) | Hardcoded from published Census figures — no key |
| **Colorado State Demography Office** — historical census | 11 anchor places | 1870–2020 decennial | Manual XLSX drop |
| **Colorado State Demography Office** — muni-pop-housing | 11 anchor places | 2010–2024 annual | Manual XLSX drop |

### Labor & employment

| Source | Coverage | API key |
|---|---|---|
| **BLS QCEW** — covered employment + wages by NAICS | County, state | `BLS_API_KEY` (optional; raises 25→500 queries/day) |
| **BLS LAUS** — monthly labor force / employment / unemployment | County, state | `BLS_API_KEY` |
| **BLS CEX Table 1300** — income, tax, spending by age of reference person | National | Manual XLSX drop from `bls.gov/cex/tables.htm` |
| **BEA REIS** — CAINC1 (per-capita income), CAEMP25N (employment by industry), CAGDP9 (county GDP) | County, state | `BEA_API_KEY` |
| **CDLE OEWS** — Occupational Employment & Wage Statistics | State, nonmetro area | Via BLS API |

### Housing

| Source | Coverage | API key |
|---|---|---|
| **Census ACS** — B25003, B25004, B25064, B25070, B25077, B25091 | State / county / place / ZCTA | `CENSUS_API_KEY` |
| **Census BPS** — annual residential building permits | County, place | `CENSUS_API_KEY` |
| **HUD FMR** — Fair Market Rents | County | `HUD_API_TOKEN` |
| **HUD CHAS** — Comprehensive Housing Affordability Strategy | County, place | Bulk zip download — no key |
| **Zillow ZHVI / ZORI** — home values + rents | ZIP, city, county, state | Bulk CSV from `files.zillowstatic.com` — no key |
| **IPUMS NHGIS** — decennial housing units reconciled to current boundaries | 11 anchor places, anchor counties, 1970–2020 | Manual XLSX drop |

### Commerce

| Source | Coverage | API key |
|---|---|---|
| **Census CBP / ZBP** — establishment counts + employment by NAICS-2 | County, place, ZCTA | `CENSUS_API_KEY` |
| **CDOR Sales Tax Statistics** | Colorado jurisdictions | Via Socrata (`SOCRATA_APP_TOKEN` optional, raises rate limits) |
| **CDOR Lodging Tax Reports** | County + Local Marketing Districts | Via Socrata |
| **Home-rule city sales tax** — Glenwood Springs, Aspen, Carbondale, Snowmass Village, Basalt | Per-city monthly | Manual file drops; per-city formats vary (PDF, XLSX) |

### Tourism

| Source | Coverage |
|---|---|
| **BTS T-100 segment** — airport enplanements | ASE (Aspen), EGE (Eagle/Vail), GJT (Grand Junction) |
| **RFTA Year-in-Review** — annual ridership | Roaring Fork Valley regional transit |
| **Colorado Tourism Office** — Longwoods visitor profile | State + DMOs |
| **Municipal STR registries** | Per-city — uneven; manual collection |

### Map & routing

| Source | Role | Notes |
|---|---|---|
| **OpenStreetMap + CARTO Dark Matter** | Basemap tiles | © OpenStreetMap contributors, © CARTO |
| **Mapzen Terrain Tiles** (AWS Open Data) | Hillshade relief layer | Terrarium-encoded DEM. Toggle via `VITE_HILLSHADE_ENABLED` in `.env.local`. |
| **OSRM** (`router.project-osrm.org` demo) | Build-time only | Fetches real road geometry for the 14 named corridors. Cached locally; runtime never calls OSRM. |

## Run locally

```bash
npm install
npm run dev          # → http://localhost:5173
npm run build        # production build to dist/
```

## Refreshing data

The pipeline has two independent layers — commute flows and regional context.

**Commute flows (LEHD LODES8):**

```bash
python3 scripts/fetch-lodes.py    # one-time ~10 min bulk fetch
python3 scripts/build-data.py     # → public/data/{flows-*,rac,wac,od-summary,zips,corridors}.json
```

**Regional context (Census, BLS, BEA, HUD, Zillow, CDOR, BTS, …):**

```bash
npm run fetch:context:census      # ACS / PEP / Decennial / CBP / BPS
npm run fetch:context:labor       # BLS QCEW + LAUS, BEA REIS, CDLE OEWS
npm run fetch:context:housing     # Zillow, HUD FMR, HUD CHAS, BPS
npm run fetch:context:tax         # CDOR sales + lodging tax (Socrata)
npm run fetch:context:tourism     # BTS, RFTA, Longwoods, STR registries
npm run fetch:context:economic    # BLS CEX Table 1300
npm run build:context             # → public/data/context/*.json
```

API keys (Census, BLS, BEA, HUD) live in `.env.local` (gitignored). Copy `.env.example` to `.env.local` and fill in whichever keys you have — every fetcher gracefully skips any series whose key is unset, so partial keysets are fine. Cached responses live under `data/context-cache/` (also gitignored), making subsequent builds offline.

## Deploy

Pushes to `main` automatically build and deploy to GitHub Pages via `.github/workflows/deploy.yml`. The `dist/` output is fully static and self-contained — no env vars, no API keys at runtime.

## License & attribution

- **Map base:** © OpenStreetMap contributors, © CARTO
- **Hillshade:** Mapzen Terrain Tiles (AWS Open Data; terrarium-encoded DEM blending JAXA AW3D30, USGS NED, ETOPO1, and others — see [joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md))
- **Centroids:** U.S. Census Bureau, TIGER 2024 ZCTA Gazetteer
- **Workforce + commute flows:** U.S. Census Bureau, **LEHD LODES8 (vintage 8.4)** — Origin-Destination, Workplace Area Characteristics, Residence Area Characteristics; Colorado, 2002–2023, JT00 (All Jobs)
- **Regional context:** U.S. Census Bureau (ACS, PEP, Decennial, CBP, BPS); U.S. Bureau of Labor Statistics (QCEW, LAUS, CEX); U.S. Bureau of Economic Analysis (REIS); U.S. Department of Housing and Urban Development (FMR, CHAS); Zillow Research; Colorado Department of Revenue (Sales + Lodging Tax via Socrata); Colorado State Demography Office; IPUMS NHGIS; U.S. Bureau of Transportation Statistics (T-100); RFTA; Colorado Tourism Office
- **Routing:** OSRM (Open Source Routing Machine demo server, build-time only)
- **Code:** internal — City of Glenwood Springs Economic Development
