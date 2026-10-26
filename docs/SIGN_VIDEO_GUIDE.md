# IREME sign-language video upload guide

## How the app chooses a video

Place MP4 files in `frontend/public/sign-videos/`. The video filename must match exactly, including lowercase letters and underscores. When the interface language is English, IREME looks for `en_...mp4`; when it is Kinyarwanda, it looks for `rw_...mp4`.

The current player selects a **page summary clip** when sign language is enabled, and a **chart explanation clip** when the user focuses/opens a supported chart. It does not automatically translate every arbitrary paragraph or all text on the screen into sign language. Record each script below as a clear, complete sign-language explanation. For Rwanda, use a fluent Rwanda Sign Language signer; do not assume American Sign Language (ASL) is interchangeable.

## Page video files and scripts

Record both English and Kinyarwanda versions for each page. Each row gives the exact file names and the suggested text/meaning to sign.

| Page | English filename | Kinyarwanda filename | English script to sign | Kinyarwanda script to sign |
|---|---|---|---|---|
| Dashboard | `en_dashboard.mp4` | `rw_dashboard.mp4` | Welcome to IREME. Explore Rwanda agriculture information, crop statistics, weather forecasts, and farming support. | Murakaza neza kuri IREME. Reba amakuru y'ubuhinzi mu Rwanda, imibare y'ibihingwa, iteganyagihe n'ubufasha ku bahinzi. |
| Farmer data | `en_farmer_data.mp4` | `rw_farmer_data.mp4` | Farmer data lets you submit information about your farm and harvest. Submitted information is not official NISR data until it has been checked. | Amakuru y'umuhinzi agufasha gutanga amakuru yerekeye umurima n'umusaruro. Amakuru watanze si imibare yemewe ya NISR ataragenzurwa. |
| Statistics | `en_statistics.mp4` | `rw_statistics.mp4` | Agricultural statistics help you compare crop production, land area, and farming practices. Use the filters to select the crop, district, season, and year. | Imibare y'ubuhinzi igufasha kugereranya umusaruro w'ibihingwa, ubuso bw'ubutaka n'imikorere y'ubuhinzi. Koresha amahitamo uhitamo igihingwa, akarere, igihembwe n'umwaka. |
| Smart Farm Advisor | `en_smart_farm_advisor.mp4` | `rw_smart_farm_advisor.mp4` | The Smart Farm Advisor provides data-informed farming suggestions using available crop information, district selection, and weather forecasts. Recommendations are guidance, not guarantees. | Umujyanama w'ubuhinzi atanga inama zishingiye ku makuru y'ibihingwa, akarere n'iteganyagihe biboneka. Izi nama ni ubuyobozi, si isezerano ry'umusaruro. |
| Forecast | `en_forecast.mp4` | `rw_forecast.mp4` | Choose a district to view the short-term weather forecast, including expected rainfall and temperatures. Check official Rwanda Meteorology Agency updates for seasonal decisions. | Hitamo akarere urebe iteganyagihe ry'igihe gito, harimo imvura n'ubushyuhe biteganyijwe. Ku byemezo by'ibihe by'ihinga, reba amakuru y'Ikigo cy'Igihugu gishinzwe Iteganyagihe. |
| Crop Scan | `en_crop_scan.mp4` | `rw_crop_scan.mp4` | Upload or take a clear photo of an affected leaf or crop. IREME will show the model's predicted class and available guidance. A model result is a screening aid, not a confirmed diagnosis. | Ohereza cyangwa ufate ifoto isobanutse y'ikibabi cyangwa igihingwa cyafashwe. IREME izerekana icyo muderi yagaragaje n'inama zihari. Ibyavuye muri muderi ni ubufasha mu gusuzuma, si isuzuma ryemejwe. |
| Ask IREME | `en_ask_ireme.mp4` | `rw_ask_ireme.mp4` | Ask IREME about crops, seasons, farming practices, soil conservation, or common crop diseases. Answers depend on the information available to the app. | Baza IREME ku bihingwa, ibihe by'ihinga, uburyo bwo guhinga, kurinda ubutaka cyangwa indwara zisanzwe z'ibihingwa. Ibisubizo bishingira ku makuru porogaramu ifite. |
| Admin data | `en_admin_data.mp4` | `rw_admin_data.mp4` | This is the administration area for authorized users to manage agricultural records. Sign in with the configured administrator credentials. | Aha ni ahagenewe abayobozi bemerewe gucunga amakuru y'ubuhinzi. Injira ukoresheje amakuru y'ibanga y'umuyobozi yashyizweho. |

## Chart explanation video files

These files are optional, but IREME will request them when the corresponding chart is focused or its explanation is opened while sign language is enabled.

| Chart | English filename | Kinyarwanda filename | Suggested meaning to sign |
|---|---|---|---|
| Crop production | `en_crop_production.mp4` | `rw_crop_production.mp4` | This chart compares reported production for selected crops. Values are in tonnes, not yield per hectare. | Iki gishushanyo kigereranya umusaruro watangajwe ku bihingwa byatoranyijwe. Imibare iri muri toni, si umusaruro kuri hegitari. |
| Agricultural practices by season | `en_agricultural_practices_by_season.mp4` | `rw_agricultural_practices_by_season.mp4` | This chart compares reported farming practices across seasons. Check the labels and source notes to understand which practices are included. | Iki gishushanyo kigereranya imikorere y'ubuhinzi mu bihembwe. Reba amazina n'aho amakuru yavuye kugira ngo umenye imikorere irimo. |
| Land use | `en_land_use.mp4` | `rw_land_use.mp4` | This chart summarizes reported agricultural land use for Season A 2024. The figures describe the survey and should be read with its source notes. | Iki gishushanyo kigaragaza uko ubutaka bw'ubuhinzi bwakoreshejwe mu Igihembwe A cya 2024. Soma imibare hamwe n'ibisobanuro by'aho amakuru yavuye. |
| Input use across seasons | `en_input_use_across_seasons.mp4` | `rw_input_use_across_seasons.mp4` | This chart compares reported use of agricultural inputs across seasons. Percentages describe survey responses, not a recommendation for every farm. | Iki gishushanyo kigereranya ikoreshwa ry'inyongeramusaruro mu bihembwe. Ijanisha ryerekana ibisubizo by'ubushakashatsi, si inama ihuye na buri murima. |

## Recording checklist

- Save files as MP4 using the exact names above.
- Record one meaning per clip; keep the signer centered and hands/face visible.
- Use good lighting, a plain background, and a steady camera.
- Leave a short pause at the start and end; avoid music and background noise.
- Keep the same language in the filename and script: `en_` for English meaning and `rw_` for Kinyarwanda meaning.
- Upload clips to `frontend/public/sign-videos/` and restart/reload the frontend.
- If a file is missing, the app shows its placeholder instead of a translated video.
