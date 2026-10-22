import React from "react";
import DOMPurify from "dompurify";

export function Perfil({ usuario }) {
  return (
    <div className="perfil">
      <h2>{usuario.nombre}</h2>
      <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(usuario.biografia) }} />
    </div>
  );
}
