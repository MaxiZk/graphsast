import React from "react";

export function Perfil({ usuario }) {
  return (
    <div className="perfil">
      <h2>{usuario.nombre}</h2>
      <div dangerouslySetInnerHTML={{ __html: usuario.biografia }} />
    </div>
  );
}
