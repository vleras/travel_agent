# Chapter 6 analysis (pandas 3.0.2, scipy 1.17.1)
## E1: 600 scenarios, 84 duplicates, 516 distinct
duplicates by city/D: {('bangkok', 5): 27, ('barcelona', 5): 27, ('paris', 5): 3, ('tokyo', 5): 27}
                                    metoda  K_mesatare  K_mediana  L_totale_km  L_max_mesatare_km  L_max_mediana_km  sigma  dite_kompakte_pct  koha_mediana_ms  koha_max_ms
                        Metoda e propozuar       59.90      64.29        67.63              49.23             14.36   0.44              50.05             0.07         1.75
                        Ndarja pa rishikim       57.30      63.54        66.92              44.89             13.91   0.01              43.73             0.07         0.51
                                 k-means++       52.75      59.49        69.11              35.59             12.80   2.26              37.69             0.01         0.03
Ndarja sipas renditjes së vendeve në listë       44.83      50.00        80.50              43.85             19.20   0.01              25.22             0.00         0.05
                          Ndarja rastësore       45.05      49.07        80.30              42.99             16.20   0.01              23.47             0.00         0.01
E1 by city (mean): {('max_L', 'B1'): {'bangkok': 153.0, 'barcelona': 14.1, 'paris': 15.5, 'rome': 14.4, 'tokyo': 33.3}, ('max_L', 'B2'): {'bangkok': 153.9, 'barcelona': 13.4, 'paris': 18.7, 'rome': 13.4, 'tokyo': 35.1}, ('max_L', 'B3'): {'bangkok': 129.1, 'barcelona': 12.0, 'paris': 11.4, 'rome': 11.3, 'tokyo': 27.4}, ('max_L', 'B4'): {'bangkok': 180.4, 'barcelona': 12.2, 'paris': 11.8, 'rome': 12.1, 'tokyo': 26.0}, ('max_L', 'P'): {'bangkok': 197.8, 'barcelona': 12.3, 'paris': 12.1, 'rome': 12.2, 'tokyo': 32.1}, ('mean_K', 'B1'): {'bangkok': 19.6, 'barcelona': 59.4, 'paris': 57.4, 'rome': 64.3, 'tokyo': 15.8}, ('mean_K', 'B2'): {'bangkok': 18.9, 'barcelona': 60.5, 'paris': 54.6, 'rome': 65.7, 'tokyo': 15.9}, ('mean_K', 'B3'): {'bangkok': 14.3, 'barcelona': 66.3, 'paris': 67.2, 'rome': 70.5, 'tokyo': 36.5}, ('mean_K', 'B4'): {'bangkok': 33.1, 'barcelona': 68.6, 'paris': 69.9, 'rome': 74.1, 'tokyo': 32.6}, ('mean_K', 'P'): {'bangkok': 41.5, 'barcelona': 69.0, 'paris': 69.9, 'rome': 74.1, 'tokyo': 38.3}}

## H1 and H2 (sigma rows: "better" = P has lower sigma)
   hypothesis                                   baseline metric  better  equal  worse  median_diff  median_diff_nonzero            p       p_holm
           H1                           Ndarja rastësore      K     516      0      0    13.245000            13.245000 3.086142e-86 1.234457e-85
           H1 Ndarja sipas renditjes së vendeve në listë      K     506      4      6    13.000000            13.333333 2.655861e-85 7.967583e-85
           H1                                  k-means++      K     447      3     66     3.289167             3.300000 1.639208e-64 1.639208e-64
H1 plotësuese                                  k-means++  sigma     499      4     13     1.903826             1.907652 4.504377e-84 9.008755e-84
           H2                         Ndarja pa rishikim      K     223    262     31     0.000000             4.500000 3.094471e-31 3.094471e-31
H2 plotësuese                         Ndarja pa rishikim  sigma       3    265    248     0.000000            -0.816497 1.691391e-43 3.382782e-43
revision changed the split in 258 of 516 scenarios; K changed in 254; K lower with revision in 31

## H3: 12 of 12 subgroups meet the criterion (Holm over 36 tests)
subgroup     value                                   baseline   n  better  worse  median_diff  p_holm
   ritmi   relaxed                           Ndarja rastësore 172     172      0      16.7417  0.0000
   ritmi   relaxed Ndarja sipas renditjes së vendeve në listë 172     170      2      17.0000  0.0000
   ritmi   relaxed                                  k-means++ 172     151     21       5.2192  0.0000
   ritmi  balanced                           Ndarja rastësore 172     172      0      12.4256  0.0000
   ritmi  balanced Ndarja sipas renditjes së vendeve në listë 172     168      3      12.5000  0.0000
   ritmi  balanced                                  k-means++ 172     151     19       3.3408  0.0000
   ritmi    packed                           Ndarja rastësore 172     172      0       9.2625  0.0000
   ritmi    packed Ndarja sipas renditjes së vendeve në listë 172     168      1       9.4500  0.0000
   ritmi    packed                                  k-means++ 172     145     26       2.3278  0.0000
   ditet         2                           Ndarja rastësore 150     150      0       9.2667  0.0000
   ditet         2 Ndarja sipas renditjes së vendeve në listë 150     143      4       9.5000  0.0000
   ditet         2                                  k-means++ 150     116     32       1.9917  0.0000
   ditet         3                           Ndarja rastësore 150     150      0      13.3556  0.0000
   ditet         3 Ndarja sipas renditjes së vendeve në listë 150     147      2      13.5000  0.0000
   ditet         3                                  k-means++ 150     123     26       2.8944  0.0000
   ditet         4                           Ndarja rastësore 150     150      0      16.7625  0.0000
   ditet         4 Ndarja sipas renditjes së vendeve në listë 150     150      0      16.2500  0.0000
   ditet         4                                  k-means++ 150     142      8       4.5042  0.0000
   ditet         5                           Ndarja rastësore  66      66      0      14.4633  0.0000
   ditet         5 Ndarja sipas renditjes së vendeve në listë  66      66      0      14.7000  0.0000
   ditet         5                                  k-means++  66      66      0       3.5200  0.0000
  qyteti      rome                           Ndarja rastësore 120     120      0       9.8100  0.0000
  qyteti      rome Ndarja sipas renditjes së vendeve në listë 120     112      5       8.0000  0.0000
  qyteti      rome                                  k-means++ 120     107     12       3.5444  0.0000
  qyteti     paris                           Ndarja rastësore 117     117      0      11.6533  0.0000
  qyteti     paris Ndarja sipas renditjes së vendeve në listë 117     117      0      14.8000  0.0000
  qyteti     paris                                  k-means++ 117     101     15       2.9500  0.0000
  qyteti barcelona                           Ndarja rastësore  93      93      0       8.8750  0.0000
  qyteti barcelona Ndarja sipas renditjes së vendeve në listë  93      91      1       8.0000  0.0000
  qyteti barcelona                                  k-means++  93      88      5       2.3167  0.0000
  qyteti     tokyo                           Ndarja rastësore  93      93      0      23.5778  0.0000
  qyteti     tokyo Ndarja sipas renditjes së vendeve në listë  93      93      0      22.0000  0.0000
  qyteti     tokyo                                  k-means++  93      62     30       1.1417  0.0002
  qyteti   bangkok                           Ndarja rastësore  93      93      0      23.8417  0.0000
  qyteti   bangkok Ndarja sipas renditjes së vendeve në listë  93      93      0      22.6667  0.0000
  qyteti   bangkok                                  k-means++  93      89      4      28.5000  0.0000

## E2: 60 scenarios (all used; descriptive only)
                                    metoda  K_mesatare  K_mediana  L_totale_km  L_max_mesatare_km  L_max_mediana_km  sigma  dite_kompakte_pct  koha_mediana_ms  koha_max_ms
                        Metoda e propozuar       48.79      55.00        99.15              73.10             18.64   1.16              32.42             0.48         1.12
                        Ndarja pa rishikim       46.09      51.25        98.39              69.56             18.13   1.16              27.64             0.47         1.07
                                 k-means++       41.04      44.34       101.58              46.52             23.79   3.72              23.77             0.01         0.03
Ndarja sipas renditjes së vendeve në listë       29.13      23.62       121.02              58.70             29.08   0.33               9.36             0.00         0.00
                          Ndarja rastësore       30.55      27.01       118.77              57.84             25.59   0.33               9.27             0.00         0.00
E2 by city (mean): {('max_L', 'B1'): {'bangkok': 184.3, 'barcelona': 18.7, 'paris': 22.6, 'rome': 20.6, 'tokyo': 42.9}, ('max_L', 'B2'): {'bangkok': 179.6, 'barcelona': 19.3, 'paris': 27.1, 'rome': 20.9, 'tokyo': 46.7}, ('max_L', 'B3'): {'bangkok': 148.4, 'barcelona': 16.5, 'paris': 16.6, 'rome': 18.5, 'tokyo': 32.7}, ('max_L', 'B4'): {'bangkok': 267.7, 'barcelona': 14.4, 'paris': 15.5, 'rome': 18.1, 'tokyo': 32.1}, ('max_L', 'P'): {'bangkok': 278.9, 'barcelona': 13.5, 'paris': 15.6, 'rome': 18.1, 'tokyo': 39.4}, ('mean_K', 'B1'): {'bangkok': 13.1, 'barcelona': 45.4, 'paris': 38.2, 'rome': 46.0, 'tokyo': 10.0}, ('mean_K', 'B2'): {'bangkok': 11.2, 'barcelona': 45.7, 'paris': 35.1, 'rome': 46.0, 'tokyo': 7.5}, ('mean_K', 'B3'): {'bangkok': 8.5, 'barcelona': 55.3, 'paris': 56.0, 'rome': 56.9, 'tokyo': 28.5}, ('mean_K', 'B4'): {'bangkok': 28.3, 'barcelona': 58.8, 'paris': 57.0, 'rome': 59.9, 'tokyo': 26.5}, ('mean_K', 'P'): {'bangkok': 35.8, 'barcelona': 59.7, 'paris': 57.3, 'rome': 59.9, 'tokyo': 31.1}}
P vs Ndarja rastësore: better 58 / equal 1 / worse 1
P vs Ndarja sipas renditjes së vendeve në listë: better 58 / equal 2 / worse 0
P vs k-means++: better 52 / equal 1 / worse 7
P vs Ndarja pa rishikim: better 31 / equal 27 / worse 2
revision changed the split in 33 of 60; moves in total: 50

## KJ7 (time per scenario) and KJ3
machine: Apple M5, {'platform': 'darwin', 'release': '25.6.0', 'arch': 'arm64'}, Node v26.0.0
experiment               step  median_ms  p95_ms  max_ms
        E1             ndarja      0.071   0.346   0.507
        E1 ndarja + rishikimi      0.075   0.354   1.749
        E2             ndarja      0.473   1.014   1.069
        E2 ndarja + rishikimi      0.477   1.014   1.117
KJ3: proposed method run twice per scenario, identical in 660 of 660 (the runner asserts equality; a mismatch stops the run)

## Localization test (run 2026-10-19T18:17:27.615Z – 2026-10-19T18:23:55.599Z, code b8d512a)
                   grupi  n  gjetur  gjetur_pct  largesia_mediane_m  brenda_pragut  brenda_pragut_pct  brenda_pragut_pct_e_gjeturave
               të gjitha 93      79        84.9               132.2             69               74.2                           87.3
      atraksione (300 m) 55      54        98.2                73.7             45               81.8                           83.3
             zona (1 km) 38      25        65.8               251.0             24               63.2                           96.0
                    Rome 20      16        80.0               145.9             13               65.0                           81.2
                   Paris 20      19        95.0                59.9             18               90.0                           94.7
               Barcelona 19      17        89.5               145.5             14               73.7                           82.4
                   Tokyo 18      14        77.8               167.3             13               72.2                           92.9
                 Bangkok 16      13        81.2               147.5             11               68.8                           84.6
ekskursionet e Bangkokut  2       0         0.0                 NaN              0                0.0                            0.0
      vendet pa artikull  3       2        66.7               110.7              0                0.0                            0.0
excursions: [{'name': 'Damnoen Saduak Floating Market', 'found': False}, {'name': 'Ayutthaya Day Trip Hub', 'found': False}]
no article: [{'name': "Caffè Sant'Eustachio", 'found': True, 'distance_m': 165.0}, {'name': 'Roscioli Salumeria', 'found': True, 'distance_m': 57.0}, {'name': 'Seine River Cruise', 'found': False, 'distance_m': nan}]
not found (main): Trastevere Food Walk, Appian Way Park, Ostiense Street Art, Monti Neighborhood, Latin Quarter Food Walk, El Born Tapas Crawl, Gràcia Neighborhood, Senso-ji Temple, Koenji Vintage District, Sumida River Cruise, Nakameguro Canal, Chatuchak Weekend Market, Thonglor Cafés, Talad Noi Heritage Walk
found outside threshold: Trevi Fountain (528 m), Vatican Museums (565 m), St. Peter's Basilica (622 m), Montmartre & Sacré-Cœur (451 m), Park Güell (497 m), Casa Batlló (365 m), Barceloneta Beach (1054 m), Tokyo National Museum (10310 m), Grand Palace (313 m), Wat Pho (2285 m)
matched service: {'photon': 77, 'geoapify': 2}
by input: 17 date inputs, 24 location inputs, 7 flow checks without an input format
      grupi                                     kategoria  hyrje  te_sakta
      Datat                            Formate të njohura      4         4
      Datat                                 Data relative      2         2
      Datat                             Përgjigje pa datë      7         7
      Datat                             Data të pamundura      2         2
      Datat                           Data në të kaluarën      4         4
      Datat Formate që duhet t’i kalojnë modelit gjuhësor      3         3
Vendndodhja             Koordinata në formate të ndryshme     15        15
Vendndodhja                                Lidhje hartash      4         4
Vendndodhja                          Vlera jashtë kufijve      2         2
Vendndodhja                 Tekste që nuk janë koordinata      3         3

## Input interpretation: 37 cases, 37 correct
           category  raste  te_sakta
          date_flow      7         7
          date_past      5         5
    loc_coordinates     10        10
      loc_map_links      3         3
loc_not_coordinates      1         1
      date_to_model      2         2
    date_impossible      2         2
          date_none      6         6
date_known_relative      1         1

## Map example (E1-rome-D3-balanced-r5)
Ndarja sipas renditjes së vendeve në listë: mean K 56.33; days: K=72, 8.4 km, 4 places; K=30, 20.9 km, 4 places; K=67, 10.0 km, 4 places
Metoda e propozuar: mean K 70.00; days: K=64, 10.9 km, 5 places; K=82, 5.5 km, 3 places; K=64, 10.8 km, 4 places
