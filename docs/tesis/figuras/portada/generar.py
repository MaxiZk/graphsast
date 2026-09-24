"""Genera portada-fondo.tex: red de nodos tenue y un camino source -> sink
resaltado con los colores de la interfaz de GraphSAST. Semilla fija para
que el resultado sea reproducible. Coordenadas en mm sobre A4 (210 x 297),
origen abajo a la izquierda."""
import math, random

random.seed(20261117)
pts = []
while len(pts) < 70:
    x = random.uniform(60, 215)
    y = random.uniform(-5, 302)
    # más densidad hacia el borde derecho
    if random.random() > (x - 60) / 155 + 0.15:
        continue
    if all(math.dist((x, y), p) > 11 for p in pts):
        pts.append((x, y))

edges = set()
for i, p in enumerate(pts):
    near = sorted(range(len(pts)), key=lambda j: math.dist(p, pts[j]))[1:3]
    for j in near:
        edges.add(tuple(sorted((i, j))))

# camino resaltado en la zona libre (abajo a la derecha)
path = [(128, 62), (146, 88), (166, 70), (184, 96), (198, 74)]
sanit = [(146, 88), (152, 116), (170, 128)]

o = [r"""\documentclass[tikz]{standalone}
\usetikzlibrary{arrows.meta}
\definecolor{gsAccent}{HTML}{4F8CFF}
\definecolor{gsSource}{HTML}{14B8A6}
\definecolor{gsSink}{HTML}{EF4444}
\definecolor{gsRisk}{HTML}{F97316}
\definecolor{gsOk}{HTML}{22C55E}
\begin{document}
\begin{tikzpicture}[x=1mm, y=1mm]
\useasboundingbox (0,0) rectangle (210,297);
% franja lateral
\fill[gsAccent, opacity=0.08] (0,0) rectangle (6,297);
\fill[gsRisk, opacity=0.55] (0,0) rectangle (1.2,297);
% red tenue"""]
for i, j in sorted(edges):
    (x1, y1), (x2, y2) = pts[i], pts[j]
    o.append(rf"\draw[gsAccent, opacity=0.16, line width=0.35pt] ({x1:.1f},{y1:.1f}) -- ({x2:.1f},{y2:.1f});")
for x, y in pts:
    o.append(rf"\fill[gsAccent, opacity=0.20] ({x:.1f},{y:.1f}) circle (0.9);")
o.append("% rama saneada")
for (x1, y1), (x2, y2) in zip(sanit, sanit[1:]):
    o.append(rf"\draw[gsOk, opacity=0.7, line width=0.9pt, dashed, -{{Stealth[length=2.2mm]}}] ({x1},{y1}) -- ({x2},{y2});")
o.append(rf"\filldraw[fill=white, draw=gsOk, opacity=0.9, line width=1pt] ({sanit[1][0]},{sanit[1][1]}) circle (2.4);")
o.append(rf"\fill[gsOk, opacity=0.35] ({sanit[2][0]},{sanit[2][1]}) circle (1.6);")
o.append("% camino de riesgo")
for (x1, y1), (x2, y2) in zip(path, path[1:]):
    o.append(rf"\draw[gsRisk, opacity=0.85, line width=1.4pt, shorten >=2.6mm, shorten <=2.6mm, -{{Stealth[length=2.6mm]}}] ({x1},{y1}) -- ({x2},{y2});")
for k, (x, y) in enumerate(path):
    if k == 0:
        o.append(rf"\filldraw[fill=gsSource, draw=gsSource, opacity=0.9] ({x},{y}) circle (3.2);")
    elif k == len(path) - 1:
        o.append(rf"\filldraw[fill=gsSink, draw=gsSink, opacity=0.9] ({x},{y}) circle (3.6);")
    else:
        o.append(rf"\filldraw[fill=white, draw=gsRisk, opacity=0.9, line width=1.2pt] ({x},{y}) circle (2.4);")
o.append(r"""\end{tikzpicture}
\end{document}""")
open("portada-fondo.tex", "w").write("\n".join(o) + "\n")
print(len(pts), "nodos,", len(edges), "aristas")
