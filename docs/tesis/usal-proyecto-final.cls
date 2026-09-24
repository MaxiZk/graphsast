% =============================================================
%   Template LaTeX — Proyecto Final de Ingeniería Informática
%   Universidad del Salvador (USAL) — Facultad de Ingeniería
%   ver 1.0 // septiembre 2026
%
%   Adaptado por Norman Funes para la cátedra de Proyecto Final
%   (prof. Esteban Tissera) a partir de:
%     - Francesco Barone, "unipd-thesis-modern" v1.3.1,
%       github.com/baronefr/unipd-thesis-modern (licencia CC)
%     - que a su vez adapta la portada de Luca Martinelli,
%       "Computer Engineering MsC Thesis - UniPD" (Overleaf)
%
% -------------------------------------------------------------
%   ORGANIZACIÓN DE ESTE ARCHIVO
%     1. Configuración general y opciones de la clase
%     2. Fuentes e idioma
%     3. Paquetes
%     4. Datos de la tesis (\title, \author, \advisor, ...)
%     5. Estilo de títulos, encabezados y pies
%     6. Preliminares (\frontmatter): resumen, índices, glosario...
%     7. Portada (\maketitle y \makecover)   <-- portada, logos y
%                                                marca de agua
%     8. Cuerpo (\mainmatter) y cierre (\backmatter, anexos, CV)
%     9. Extras (template/extras.tex): cajas, código, Gantt, tablas
%    10. Exportación PDF/A, hipervínculos y glosario
% =============================================================

\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{usal-proyecto-final}[2026/09/07 v1.0 Template Proyecto Final USAL]


% =============================================================
% 1. CONFIGURACIÓN GENERAL Y OPCIONES
% =============================================================

\LoadClass[11pt, a4paper, twoside, openright]{book}

% geometría de página (doble faz, encuadernación a la izquierda)
\RequirePackage[
  twoside, a4paper,
  inner=35mm, outer=25mm,
  top=27mm, bottom=27mm,
  headsep=5mm, headheight=14pt,
  footskip=11mm,
  marginparwidth=0mm, marginparsep=0mm,
]{geometry}

% opciones de la clase:
%   language=spanish|english   idioma (por defecto spanish)
%   guias=true|false           mostrar u ocultar las cajas de guía
%                              de la cátedra (por defecto true).
%                              Para la entrega final: guias=false.
\RequirePackage{kvoptions}
\SetupKeyvalOptions{family=usal, prefix=usal@}
\DeclareStringOption[spanish]{language}
\DeclareBoolOption[true]{guias}
%   pdfa=true|false            generar PDF/A-2b con pdfx (por defecto false:
%                              compila más rápido; activar solo si lo piden)
\DeclareBoolOption[false]{pdfa}
\ProcessKeyvalOptions*

% paquetes que deben cargarse temprano para evitar conflictos
\RequirePackage{scrextend}
\RequirePackage[explicit]{titlesec}
\RequirePackage{etoolbox}
\RequirePackage{xparse}


% =============================================================
% 2. FUENTES E IDIOMA
% =============================================================

%% OPCIÓN 1 (por defecto): Palatino moderna. Genera PDF/A correcto
%%   con LuaLaTeX (compilador recomendado).
\RequirePackage[T1]{fontenc}
\RequirePackage{newpxtext}
\RequirePackage{newpxmath}

%% OPCIÓN 2: funciona con pdfLaTeX y LuaLaTeX, fuente muy parecida
%\RequirePackage{mathpazo}

% idioma: babel localiza capítulos, figuras, índices, fechas y
% partición silábica. Las cadenas propias del template están en
% template/<idioma>.tex
% Opciones del español (las lee spanish.ldf desde \spanishoptions):
%   es-noshorthands: desactiva los atajos con comillas y ~ de babel
%   es-tabla: "Tabla" en lugar de "Cuadro"
%   es-nolists: mantiene las listas estándar de LaTeX
\def\spanishoptions{es-noshorthands,es-tabla,es-nolists}
% El inglés se carga siempre como idioma secundario (abstract, biblatex)
\def\usal@spanishname{spanish}
\ifx\usal@language\usal@spanishname
  \RequirePackage[english,spanish]{babel}
  \spanishplainpercent % \% sin espacio automático (evita errores en tablas)
\else
  \RequirePackage[spanish,\usal@language]{babel}
\fi
\input{template/\usal@language.tex}


% =============================================================
% 3. PAQUETES
% =============================================================

% -- hyperref / PDF/A --
% Con pdfa=true se usa pdfx (que carga hyperref) para generar PDF/A-2b.
% Debe ir ANTES que TikZ: si TikZ ya escribió objetos en el PDF, pdfx no
% puede fijar la versión y da error. Validar el resultado en
% https://www.pdfforge.org/online/en/validate-pdfa
\ifusal@pdfa
    \RequirePackage{silence}
    \WarningFilter{pdfx}{Setting all color commands to rgb} % aviso esperado
    \RequirePackage[a-2b]{pdfx}
    % con LuaLaTeX pdfx deja \inputencodingname como \relax y eso rompe a
    % glossaries/datatool; se vuelve a dejar indefinido (UTF-8 nativo):
    \makeatletter
    \ifx\inputencodingname\relax \let\inputencodingname\@undefined \fi
    \makeatother
\else
    \RequirePackage{hyperref}
\fi

\RequirePackage{url}
\RequirePackage{graphicx}
\graphicspath{{figuras/}}

% colores
\RequirePackage[table]{xcolor}
    % Color principal del documento (títulos de capítulo, partes
    % e hipervínculos). Cambiarlo acá para cambiarlo en todo el PDF.
    % verde oscuro (paleta CASSIE): green!20!black!80
    \colorlet{mainColor}{green!20!black!80}
    \colorlet{chapterColor}{mainColor}
    \colorlet{partBoxColor}{mainColor}
    \colorlet{generalHyperColor}{mainColor}

% matemática
\RequirePackage{amsmath} % (los símbolos de amssymb los provee newpxmath)
\RequirePackage{makecell}

% apéndices y anexos
\RequirePackage[toc,page,title,titletoc]{appendix}
\makeatletter
\renewcommand{\appendixpagename}{\USAL@appendices}
\renewcommand{\appendixtocname}{\USAL@appendices}
\makeatother

% interlineado (\onehalfspacing, \doublespacing)
\RequirePackage{setspace}
\addtolength{\footnotesep}{1mm}

\makeatletter
\setlength{\@fptop}{0pt} % flotantes alineados al margen superior
\makeatother

\setlength{\parindent}{11pt}

% leyendas y notas al pie
\RequirePackage[font=small, labelfont=bf]{caption}
\RequirePackage{subcaption}
\RequirePackage{footnote}
\RequirePackage[bottom]{footmisc}

% marca de agua de la portada
\RequirePackage{watermark}

% dibujos
\RequirePackage{tikz}
\usetikzlibrary{shapes.geometric, arrows.meta, positioning}

% bibliografía: biblatex + biber, estilo APA (autor, año)
\RequirePackage[autostyle]{csquotes}
\RequirePackage[
  backend=biber,
  style=apa,
  natbib=true,
  urldate=long,
  maxcitenames=2,
]{biblatex}
\setlength\bibitemsep{0.5\baselineskip}

% tablas
\RequirePackage{tabularx}
\RequirePackage{multirow}
\RequirePackage{booktabs}
\RequirePackage{longtable}
\RequirePackage{xltabular}
\RequirePackage{array}
\RequirePackage{pdflscape}
\RequirePackage{float}
\RequirePackage{enumitem}
\setlist{noitemsep}


% =============================================================
% 4. DATOS DE LA TESIS
% =============================================================
\makeatletter

\def\thesisHeader#1{\gdef\@thesisHeader{#1}}   % carrera / tipo de trabajo
\def\academicYear#1{\gdef\@academicYear{#1}}   % ciclo lectivo
\def\graduationDate#1{\gdef\@graduationDate{#1}} % fecha de defensa (opcional)
\def\secondpage#1{\gdef\@secondpage{#1}}       % contenido de la 2.ª página
\def\dedication#1{\gdef\@dedication{#1}}       % dedicatoria (opcional)
\def\authorEmail#1{\gdef\@authorEmail{#1}}     % correo institucional
\def\palabrasclave#1{\gdef\@palabrasclave{#1}} % palabras clave (resumen)
\def\keywords#1{\gdef\@keywords{#1}}           % keywords (abstract)

% autoridades que figuran en la portada: \decano{Nombre}{Cargo},
% \director{Nombre}{Cargo}, \profesor{Nombre}{Cargo} y, opcionalmente,
% \tutor{Nombre}{Cargo}. Las que queden vacías no se imprimen.
\def\decano#1#2{\gdef\@decano{#1} \gdef\@decanoTitle{#2}}
\def\director#1#2{\gdef\@director{#1} \gdef\@directorTitle{#2}}
\def\profesor#1#2{\gdef\@profesor{#1} \gdef\@profesorTitle{#2}}
\def\tutor#1#2{\gdef\@tutor{#1} \gdef\@tutorTitle{#2}}
\makeatother

% valores vacíos por defecto
\decano{}{}
\director{}{}
\profesor{}{}
\tutor{}{}
\graduationDate{}
\secondpage{}
\dedication{}
\authorEmail{}
\palabrasclave{}
\keywords{}

% logos de la portada. Se pueden cambiar desde main.tex con
%   \coverlogo{template/archivo}        (logo superior)
%   \coverwatermark{template/archivo}   (marca de agua de fondo)
%   \coverwatermark{}                   (sin marca de agua)
\makeatletter
\def\USAL@logo{template/usal}
\def\USAL@watermark{}
\newcommand{\coverlogo}[1]{\gdef\USAL@logo{#1}}
\newcommand{\coverwatermark}[1]{\gdef\USAL@watermark{#1}}
\makeatother


% =============================================================
% 5. TÍTULOS, ENCABEZADOS Y PIES
% =============================================================

% listas más compactas
\let\saveditemize=\itemize
\let\savedenditemize=\enditemize
\renewenvironment{itemize}
    {\begin{spacing}{1.0}\saveditemize\itemsep0em }
    {\savedenditemize\end{spacing}}

\let\savedenumerate=\enumerate
\let\savedendenumerate=\endenumerate
\renewenvironment{enumerate}
    {\begin{spacing}{0.5}\savedenumerate}
    {\savedendenumerate\end{spacing}}

% citas textuales en cursiva
\let\savedquote\quote
\let\endsavedquote\endquote
\renewenvironment{quote}
    {\itshape\savedquote}
    {\endsavedquote}

\RequirePackage{fancyhdr}

% estilo de "parte" (opcional, no se usa por defecto)
\titleformat{\part}[display]
  {\centering}
  {}
  {0pt}
  {%
    \vspace*{\fill}
    \vspace*{-9cm}
    \setlength{\fboxsep}{5pt}
    \colorbox{partBoxColor}{\color{white}\LARGE\bfseries \partname~\thepart}\\
    \vspace{0.8cm}
    {\Huge\bfseries #1}
    \thispagestyle{empty}
    \vspace*{\fill}
  }

% estilo de capítulo: recuadro de color con el número a la izquierda
%% nota: la posición está fijada a mano. Para mover verticalmente,
%% cambiar el yshift de los tres nodos.
\newcommand*\chapterlabel{}
\titleformat{\chapter}[display]
	{\normalfont\bfseries\Huge}
	{\gdef\chapterlabel{\thechapter\ }}
 	{0pt}
 	  {\begin{tikzpicture}[remember picture,overlay]
    \node[yshift=-6cm] at (current page.north west)
      {\begin{tikzpicture}[remember picture, overlay]
        \fill[chapterColor] (0,0) rectangle(35.5mm,15mm);
        \node[anchor=north east,yshift=-5.1cm,xshift=32mm,minimum height=30mm,inner sep=0mm] at (current page.north west)
        {\parbox[top][30mm][t]{15mm}{\raggedleft
        \color{white}\bfseries\chapterlabel}};
        \node[anchor=north west,yshift=-5.1cm,xshift=42mm,text width=\textwidth,minimum height=30mm,inner sep=0mm] at (current page.north west)
              {\parbox[top][30mm][t]{\textwidth}{\raggedright\hyphenpenalty=10000 \color{black}#1}};
        \end{tikzpicture}
      };
   \end{tikzpicture}
   \gdef\chapterlabel{}
}
% capítulos sin número (resumen, agradecimientos, índices...)
\titleformat{name=\chapter,numberless}[display]
	{\normalfont\bfseries\Huge}
	{\gdef\chapterlabel{\thechapter\ }}
 	{0pt}
 	  {\begin{tikzpicture}[remember picture,overlay]
    \node[yshift=-6cm] at (current page.north west)
      {\begin{tikzpicture}[remember picture, overlay]
        \fill[chapterColor] (0,0) rectangle(35.5mm,15mm);
        \node[anchor=north west,yshift=-5.1cm,xshift=42mm,text width=\textwidth,minimum height=30mm,inner sep=0mm] at (current page.north west)
              {\parbox[top][30mm][t]{\textwidth}{\raggedright\hyphenpenalty=10000 \color{black}#1}};
       \end{tikzpicture}
      };
   \end{tikzpicture}
   \gdef\chapterlabel{}
}

\renewcommand{\headrulewidth}{0pt}
\titlespacing*{\chapter}{0pt}{0pt}{3cm}

% numeración: 1, 1.1, 1.1.1 (hasta subsubsection)
\setcounter{secnumdepth}{3}
\setcounter{tocdepth}{2}

% encabezados y pies del cuerpo
\newcommand{\setDefaultHF} {
    \fancyhf{}
    \fancyfoot[RO, LE]{\thepage}
    \fancyhead[LO]{{\footnotesize\nouppercase{\rightmark}}}
    \fancyhead[RE]{{\bfseries\footnotesize\nouppercase{\leftmark}}}
}

% índice general
\RequirePackage[titles]{tocloft}
\setlength{\cftbeforesecskip}{2pt}
\setlength{\cftbeforepartskip}{2em}
\setlength{\cftbeforechapskip}{7pt}

\fancypagestyle{plain}{%
    \fancyhf{}
    \fancyfoot[LE,RO]{\thepage}
    \renewcommand{\headrulewidth}{0pt}
}


% =============================================================
% 6. PRELIMINARES
% =============================================================
\makeatletter

% capítulo sin número que aparece en el índice y en los marcadores
\newcommand{\usal@starchapter}[1]{%
    \cleardoublepage
    \phantomsection
    \chapter*{#1}%
    \markboth{#1}{}%
    \addcontentsline{toc}{chapter}{#1}%
}

% -- resumen / abstract --
\newenvironment{resumen}{%
    \usal@starchapter{\USAL@resumen}%
}{%
    \ifx\@palabrasclave\empty\else
        \par\vspace{1em}\noindent\textbf{\USAL@palabrasclave:} \@palabrasclave
    \fi
    \vfill\null
}
\newenvironment{abstract}{%
    \usal@starchapter{\USAL@abstract}%
    \begin{otherlanguage}{english}%
}{%
    \ifx\@keywords\empty\else
        \par\vspace{1em}\noindent\textbf{Keywords:} \@keywords
    \fi
    \end{otherlanguage}%
    \vfill\null
}

% -- agradecimientos --
\newcommand{\agradecimientos}{%
    \usal@starchapter{\USAL@acknowledgments}%
    \input{preliminares/agradecimientos}%
}

% -- declaración de uso de inteligencia artificial --
\newcommand{\declaracionIA}{%
    \usal@starchapter{\USAL@aideclaration}%
    \input{preliminares/declaracion-ia}%
}
\NewDocumentCommand{\instruccionIA}{o m}{%
    \par\medskip\noindent\textbf{\USAL@prompt\IfValueT{#1}{ #1}:} \textit{#2}\par
}
\NewDocumentCommand{\respuestaIA}{o m}{%
    \par\noindent\textbf{\USAL@aioutput\IfValueT{#1}{ #1}:} #2\par\medskip
}

% -- dedicatoria --
\newcommand{\dedicationpage} {
\ifx\@dedication\empty \else
    \thispagestyle{empty}
    \vspace*{2cm}
    \phantomsection
    \begin{flushright}
    \@dedication
    \end{flushright}
    \cleardoublepage
\fi
}

% -- segunda página (declaración de originalidad, repositorios...) --
\newcommand{\secondcoverpage} {
\ifx\@secondpage\empty \else
    \phantomsection
    \@secondpage
\fi
}

% -- preliminares completos --
% Orden: portada, 2.ª página, dedicatoria, agradecimientos, resumen,
% abstract, declaración de IA, índice general, índice de figuras e
% índice de tablas. El glosario, las siglas y los símbolos van al final
% del documento (\glosarios en main.tex).
\renewcommand{\frontmatter} {
    \pagenumbering{roman}
    \pagestyle{fancy}

    \maketitle
    \secondcoverpage
    \cleardoublepage

    \pagestyle{plain}
    \setlength{\headwidth}{\textwidth}
    \fancyhf{}
    \fancyfoot[RO, LE] {\thepage}

    \dedicationpage
    \agradecimientos
    \input{preliminares/resumen}
    \input{preliminares/abstract}
    \declaracionIA

    % índices
    {\hypersetup{linkcolor=black}%
    \titlespacing*{\chapter}{0pt}{0pt}{0cm}%
    \cleardoublepage\phantomsection\pdfbookmark[0]{\contentsname}{toc}%
    \tableofcontents
    \cleardoublepage\phantomsection\addcontentsline{toc}{chapter}{\listfigurename}%
    \listoffigures
    \cleardoublepage\phantomsection\addcontentsline{toc}{chapter}{\listtablename}%
    \listoftables
    }
    \cleardoublepage
}

% -- glosario, siglas y símbolos (van al final del documento) --
\newcommand{\glosarios}{%
    \cleardoublepage
    \bookmarksetup{startatroot}
    \printglossary[type=main]
    \printglossary[type=\acronymtype]
    \printglossary[type=symbols]
}

\newcommand{\printlogos}[2][2cm]{
    \foreach \x [count=\xi] in {#2}
       { \hspace{5mm}\includegraphics[height=#1]{\x} }
}
\makeatother


% =============================================================
% 7. PORTADA (\maketitle) Y TAPA SUELTA (\makecover)
%    Acá se editan portada, logos y marca de agua.
% =============================================================
% -- PORTADA (\maketitle) --
%  La marca de agua se imprime solo si \coverwatermark{...} no está vacío.
\makeatletter

% fila de autoridad en la portada: rótulo, nombre y cargo (solo si hay nombre)
%   \USAL@coverrole{rótulo}{\@nombre}{\@cargo}
\newcommand{\USAL@coverrole}[3]{%
    \ifx#2\empty\else
        \vspace{0.3cm}
        \textsc{#1}\\
        {\setlength\parindent{1mm}
        \indent\large{\textbf{#2}}\\
        \indent\small\textbf{#3}}\par
    \fi
}
% variante con tipografía grande para \makecover
\newcommand{\USAL@coverroleL}[3]{%
    \ifx#2\empty\else
        \vspace{0.4cm}
        \textsc{#1}\\
        {\setlength\parindent{1mm}
        \indent\Large{\textbf{#2}}\\[-4mm]
        \large{\indent{#3}}}\par
    \fi
}

\renewcommand{\maketitle} {

    % geometría propia de la portada
    \newgeometry{
        top=2cm, bottom=2cm,
        inner=4cm, outer=2cm,
        headheight=0cm,includehead,includefoot
    }
    
    \fancyhf{}
    \thispagestyle{empty}

    % marca de agua (opcional)
    \ifx\USAL@watermark\empty \else
    \thiswatermark{\centering
    \put(-300,-775){\includegraphics[width=1.4\linewidth]{\USAL@watermark}} % (-297,-780)
    }
    \fi

    % logo superior (altura en el argumento opcional)
    {\hspace{-22.5mm}\noindent\printlogos[3.6cm]{\USAL@logo}}
    %  NOTA: se puede pasar una lista de imágenes para poner varios logos:
    %      \printlogos[3.6cm]{template/logo-a, template/logo-b}

    % content
    \begin{flushleft}
    \vspace{7ex}
    \normalsize\textsc{\@thesisHeader}

    % title
    \vspace{10ex}
    
    \begin{spacing}{1.1}
    \noindent\huge\textbf{\@title}
    \end{spacing}
    \end{flushleft}


    % autor y autoridades
    \setstretch{1.25}
    \vspace{1.2cm}
    \begin{flushleft}

        \large{\textbf{\@author}} \\
        \ifx\@authorEmail\empty \else \small{\texttt{\@authorEmail}}\\ \fi

    % autoridades: decano, director, profesor y tutor (si está definido)
    \vspace{0.9cm}
    \USAL@coverrole{\USAL@decano}{\@decano}{\@decanoTitle}
    \USAL@coverrole{\USAL@director}{\@director}{\@directorTitle}
    \USAL@coverrole{\USAL@profesor}{\@profesor}{\@profesorTitle}
    \USAL@coverrole{\USAL@tutor}{\@tutor}{\@tutorTitle}
    \end{flushleft}

    \vspace*{\fill}
    \begin{flushleft}
    \normalsize\textsc{\USAL@academicyear~\@academicYear}
    \ifx\@graduationDate\empty \else
		\\
		\normalsize\textsc{\USAL@graduationDate~\@graduationDate}
		\fi
    \end{flushleft}
    \vspace{5mm}
    
    % restaurar geometría
    \restoregeometry
    %\onehalfspacing
}





% -- TAPA SUELTA (\makecover): portada con tipografía más grande y sin marca de agua --

% the following prints the cover page with bigger fonts and no watermark
\makeatletter
\newcommand{\makecover} {
    % geometría propia de la portada
    \newgeometry{
        top=1.4cm, bottom=1.4cm,
        inner=4cm, outer=2cm,
        headheight=0cm,includehead,includefoot
    }
    
    \fancyhf{}
    \thispagestyle{empty}

    % logo
    {\hspace{-22.5mm}\noindent\printlogos[3.6cm]{\USAL@logo}}

    % content
    \begin{flushleft}
    \vspace{7ex}
    \large\textsc{\@thesisHeader}
    
    % title
    \vspace{10ex}
    
    \begin{spacing}{1.1}
    \noindent\huge\textbf{\@title}
    \end{spacing}
    \end{flushleft}
    
    % autor y autoridades
    \setstretch{1.25}
    \begin{flushleft}
        \Large{\textbf{\@author}} \\
        \ifx\@authorEmail\empty \else {\texttt{\@authorEmail}}\\ \fi

    % autoridades
    \vspace{0.8cm}
    \USAL@coverroleL{\USAL@decano}{\@decano}{\@decanoTitle}
    \USAL@coverroleL{\USAL@director}{\@director}{\@directorTitle}
    \USAL@coverroleL{\USAL@profesor}{\@profesor}{\@profesorTitle}
    \USAL@coverroleL{\USAL@tutor}{\@tutor}{\@tutorTitle}
    \end{flushleft}

    \vspace*{\fill}
    \begin{flushleft}
    \Large\textsc{\USAL@academicyear~\@academicYear}
    \ifx\@graduationDate\empty \else
		\\
		\Large\textsc{\USAL@graduationDate~\@graduationDate}
		\fi
    \end{flushleft}
    \vspace{5mm}
    
    % restaurar geometría
    \restoregeometry
    %\onehalfspacing
}
\makeatother







% =============================================================
% 8. CUERPO Y CIERRE
% =============================================================

\renewcommand{\mainmatter} {
    \cleardoublepage
    \pagestyle{fancy}
    \setDefaultHF
    \renewcommand{\headrulewidth}{1pt}
    \setcounter{page}{1}
    \pagenumbering{arabic}
    \setcounter{chapter}{0}
    \setstretch{1.1}
}

% cierre: bibliografía. Los apéndices, anexos y CV se agregan
% después desde main.tex.
\renewcommand{\backmatter}{
    \bookmarksetup{startatroot}
    \cleardoublepage
    \phantomsection
    \printbibliography[heading=bibintoc, title={\bibname}]
}

% anexos: material que NO fue producido por el alumno (numerados I, II...)
% Se usan después de los apéndices:  \begin{anexos} ... \end{anexos}
\makeatletter
\newenvironment{anexos}{%
    \cleardoublepage
    \bookmarksetup{startatroot}
    \renewcommand{\appendixname}{\USAL@annex}%
    \renewcommand{\appendixpagename}{\USAL@annexes}%
    \renewcommand{\appendixtocname}{\USAL@annexes}%
    \begin{appendices}
    \setcounter{chapter}{0}%
    \renewcommand{\thechapter}{\Roman{chapter}}%
}{%
    \end{appendices}
}
\makeatother


% =============================================================
% 9. EXTRAS: cajas de guía, código, Gantt, tablas
% =============================================================
\makeatletter
\input{template/extras}
\makeatother


% =============================================================
% 10. HIPERVÍNCULOS Y GLOSARIO
% =============================================================

% (hyperref o pdfx se cargan al principio de la sección 3)
\hypersetup{
  unicode=true,
  colorlinks=true,
  citecolor=generalHyperColor,
  filecolor=black,
  linkcolor=generalHyperColor,
  urlcolor=generalHyperColor,
  pdfborder={0 0 0}
}

\RequirePackage{bookmark}

% glosario, siglas y símbolos (se carga después de hyperref para
% que las entradas tengan enlaces). Las entradas se definen en
% preliminares/glosario.tex, siglas.tex y simbolos.tex
\RequirePackage[acronym, symbols, toc, translate=babel, nogroupskip]{glossaries}
\setglossarystyle{long}
\setlength{\glsdescwidth}{0.62\textwidth}
\setlength{\glspagelistwidth}{0.14\textwidth}
% las siglas y términos del glosario se imprimen como enlaces, en el
% color principal (como en CASSIE). Para dejarlos en negro:
%\renewcommand*{\glstextformat}[1]{\textcolor{black}{#1}}
\renewcommand{\glsnamefont}[1]{\textbf{#1}}
\makeglossaries
