// La web del comité (0036): un panel para el operador. Lee datos.json, que el servicio publica después de cada
// ciclo, y lo vuelve a leer cada 2 minutos. JavaScript sin compilar ni dependencias: se edita tal cual.
// Todas las horas van en UTC, como el servicio, los logs y Telegram. Arriba hay también un reloj local.
(function () {
  "use strict";

  const CADA_MS = 2 * 60 * 1000;
  const SIN_DATOS_MIN = 75; // más de 1 h y cuarto sin publicar: algo falla (0030)
  const VENTAJA_BUSCADA = 0.1; // R por operación que se quiere poder distinguir de cero
  const NOMBRE = { Google: "Gemini", Anthropic: "Claude", OpenAI: "GPT", DeepSeek: "DeepSeek", Xiaomi: "MiMo" };
  const COLOR = { Google: "#1a73e8", Anthropic: "#c15f3c", OpenAI: "#6e56cf", DeepSeek: "#9a7400", Xiaomi: "#d6336c" };
  const GLIFO = { COMPRAR: "▲", VENDER: "▼", NADA: "–", FALLO: "!" };
  const RESULTADO = { COMPRAR: "Comprar", VENDER: "Vender", NO_OPERAR: "No opera" };
  const CIERRE = { sl: "stop", tp: "objetivo", tiempo: "4 h", manual: "a mano", otro: "otro" };
  // [nombre corto, descripción]
  const SALIDAS = {
    actual: ["Objetivo 1 R (actual)", "objetivo a 1 R, la salida que se opera"],
    objetivo_2r: ["Objetivo 2 R", "objetivo a 2 R"],
    sin_objetivo: ["Sin objetivo", "sale por el stop o a las 4 h"],
    mitad_1r: ["Mitad en 1 R", "cierra la mitad en +1 R y el resto sigue con el stop en la entrada"],
    trailing_1r: ["Trailing 1 R", "el stop sigue a lo mejor alcanzado, a 1 R"],
    trailing_desde_1r: ["Trailing desde +1 R", "en +1 R, el stop pasa a la entrada y desde ahí sigue a lo mejor alcanzado, a 1 R"],
    sin_apoyo: ["Sin apoyo", "la actual, pero se cierra en la primera votación siguiente en la que el comité ya no la apoya (suma a su favor de 0 o menos)"],
    en_contra: ["En contra", "la actual, pero se cierra en la primera votación siguiente en la que el comité tiene más votos en contra que a favor"],
  };
  const salidaCorta = (clave) => (SALIDAS[clave] || [clave])[0];
  const ESTADO_HORA = {
    voto: "votó", rutina: "sin votar por rutina (mercado cerrado, posición abierta…)",
    problema: "sin votar por un problema", comite_caido: "el comité no respondió", falta: "no hubo ciclo",
  };
  const RUTINA = ["mercado cerrado", "faltan menos de", "posición u orden abierta", "ya "];

  let datos = null, errorCarga = null, firmaAlerta = null;

  // ---- Formatos ---------------------------------------------------------------------------------------------------
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const formatos = {};
  const num = (x, dec = 2) => {
    if (x == null || Number.isNaN(x)) return "—";
    formatos[dec] = formatos[dec] || new Intl.NumberFormat("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return formatos[dec].format(x);
  };
  const conSigno = (x, dec = 2) => (x == null ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + num(Math.abs(x), dec));
  const clase = (x) => (x == null || Math.abs(x) < 1e-9 ? "" : x > 0 ? "pos" : "neg");
  const R = (x, dec = 2) => (x == null ? "—" : `<span class="${clase(x)}">${conSigno(x, dec)} R</span>`);
  const pct = (x, dec = 0) => (x == null ? "—" : `${num(x * 100, dec)} %`);
  const conError = (m, e) => (m == null ? "—" : `${R(m)}${e != null ? ` <span class="tenue">± ${num(e)}</span>` : ""}`);
  const dolares = (x) => (x == null ? "—" : `${num(x, x >= 1 ? 2 : x >= 0.01 ? 3 : 4)} $`);

  const fUTC = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const fDiaUTC = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const fecha = (iso) => (iso ? fUTC.format(new Date(iso)).replace(",", "") : "—");
  const fSoloDia = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short" });
  const dia = (yyyymmdd) => (yyyymmdd ? fSoloDia.format(new Date(`${yyyymmdd}T00:00:00Z`)) : "—");
  const hora = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : "—");
  const dos = (n) => String(n).padStart(2, "0");
  const reloj = (d, utc) => utc
    ? `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}:${dos(d.getUTCSeconds())}`
    : `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
  const zonaLocal = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  function duracion(ms) {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return h < 48 ? `${h} h${m ? ` ${m} min` : ""}` : `${Math.floor(h / 24)} días`;
  }
  const hace = (iso, ahora) => `hace ${duracion(ahora - Date.parse(iso))}`;
  const lista = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
  const nombre = (familia) => NOMBRE[familia] || familia;
  const ia = (familia, titulo) => `<span class="ia" style="--color-ia:${COLOR[familia] || "#999"}"${titulo ? ` title="${esc(titulo)}"` : ""}>${esc(nombre(familia))}</span>`;
  const voto = (opcion) => { const o = opcion || "FALLO"; return `<span class="voto ${o}" title="${o.toLowerCase()}">${GLIFO[o]}</span>`; };
  const lado = (l) => (l === "COMPRA" ? '<span class="pos">▲ compra</span>' : '<span class="neg">▼ venta</span>');

  // ---- Horario de CME Globex (hora de Chicago): de domingo 17:00 a viernes 16:00, pausa diaria de 16:00 a 17:00 ----
  const chicago = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  function enChicago(t) {
    const p = Object.fromEntries(chicago.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minuto: Number(p.hour) * 60 + Number(p.minute) };
  }
  function sesionCME(t) {
    const { dia, minuto } = enChicago(t);
    if (dia === 6 || (dia === 5 && minuto >= 16 * 60) || (dia === 0 && minuto < 17 * 60)) return "cerrado";
    return minuto >= 16 * 60 && minuto < 17 * 60 ? "pausa diaria" : "abierto";
  }
  // Se vota a las hh:00 UTC si el mercado está abierto y faltan más de 4 h para el cierre del viernes (0013)
  function seVota(t) {
    const { dia, minuto } = enChicago(t);
    return sesionCME(t) === "abierto" && !(dia === 5 && minuto >= 12 * 60);
  }
  function proximaVotacion(ahora) {
    let t = Math.floor(ahora / 3600e3) * 3600e3 + 10e3;
    if (t <= ahora) t += 3600e3;
    for (let i = 0; i < 24 * 4; i++, t += 3600e3) if (seVota(t - 10e3)) return t;
    return null;
  }
  // Cuándo vuelve a abrir CME y por qué está cerrado, para no confundir el fin de semana con un fallo
  function cierreCME(ahora) {
    const estado = sesionCME(ahora);
    if (estado === "abierto") return null;
    let t = Math.floor(ahora / 3600e3) * 3600e3 + 3600e3;
    for (let i = 0; i < 24 * 4 && sesionCME(t) !== "abierto"; i++) t += 3600e3;
    const { dia } = enChicago(ahora);
    return { motivo: estado === "pausa diaria" ? "pausa diaria" : dia === 5 || dia === 6 || dia === 0 ? "fin de semana" : "cerrado", reabre: t };
  }
  const cuando = (t, ahora) => `${t - ahora < 20 * 3600e3 ? "" : `${fDiaUTC.format(new Date(t))} `}${new Date(t).toISOString().slice(11, 16)} UTC`;

  function esRutina(motivo, momento) {
    if (!motivo) return false;
    if (RUTINA.some((r) => motivo.startsWith(r))) return true;
    return motivo.startsWith("la última vela H1 cerrada") && sesionCME(Date.parse(momento) - 3600e3) !== "abierto";
  }
  const fresco = (d, ahora) => (ahora - Date.parse(d.generado)) / 60000 <= SIN_DATOS_MIN;

  // ---- Avisos: solo lo que pide atención ----------------------------------------------------------------------------
  function avisos(d, ahora) {
    const a = [];
    const s = d.sistema, salud = d.salud;
    if (!fresco(d, ahora)) a.push(["mal", `Sin noticias del sistema desde el ${fecha(d.generado)} UTC: el servicio o el VPS pueden estar caídos.`]);
    if (!s.mt5.conectado) a.push(["mal", "MetaTrader 5 no está conectado al broker."]);
    else if (!s.mt5.trading_algoritmico) a.push(["mal", "El trading algorítmico está desactivado en MT5: no se pueden enviar órdenes."]);
    if (s.modo !== "real") a.push(["aviso", "Modo prueba: las órdenes se validan, pero no se envían."]);
    const u = s.ultimo_ciclo;
    if (u && u.fases_con_fallo.length) a.push(["mal", `El ciclo de las ${hora(u.inicio)} UTC falló en: ${esc(u.fases_con_fallo.join(", "))}.`]);
    if (salud) {
      // Con el día: la tira empieza ayer a esta hora, y «las 16:00» sola no dice cuál
      const de = (estado, abierto) => salud.horas.filter((h) => h.estado === estado && (abierto == null || h.mercado_abierto === abierto)).map((h) => fecha(h.hora));
      const faltan = de("falta", true), faltanCerrado = de("falta", false), caidas = de("comite_caido");
      if (faltan.length) a.push(["mal", `No hubo ciclo ${faltan.length > 1 ? "en" : "el"} ${lista(faltan)} UTC, con el mercado abierto: esas horas no se votó.`]);
      if (faltanCerrado.length) {
        a.push(["aviso", `No hubo ciclo ${faltanCerrado.length > 1 ? "en" : "el"} ${lista(faltanCerrado)} UTC. El mercado estaba cerrado y no se habría votado, pero el servicio tendría que haber hecho su ciclo: ¿estaba parado?`]);
      }
      if (caidas.length) a.push(["mal", `El comité de n8n no respondió ${caidas.length > 1 ? "en" : "el"} ${lista(caidas)} UTC: esas horas no se votó.`]);
      for (const h of salud.horas.filter((x) => x.estado === "problema")) {
        a.push(["aviso", `Sin votar por un problema el ${fecha(h.hora)} UTC: ${esc(h.problemas.join("; "))}.`]);
      }
      for (const x of salud.por_ia) {
        if (!x.fallos || (x.fallos < 3 && x.fallos / Math.max(1, x.votos) < 0.2)) continue;
        const tipos = x.tipos.map((t) => `${t.n} «${esc(t.tipo)}» en ${esc(t.proveedor)}`);
        const ultimo = x.tipos.reduce((m, t) => (t.ultimo > m ? t.ultimo : m), "");
        const cambiado = x.tipos.every((t) => t.proveedor !== x.proveedor);
        a.push([cambiado ? "info" : "aviso", `${nombre(x.familia)}: ${x.fallos} de ${x.votos} votos fallaron en 24 h (${lista(tipos)}); el último, el ${fecha(ultimo)} UTC.` +
          (cambiado ? ` Ya vota con otro proveedor, ${esc(x.proveedor)}.` : "")]);
      }
      for (const o of salud.ordenes.incidencias) {
        a.push(["aviso", `Orden de ${esc(o.tipo)} ${esc(o.estado)} en ${esc(o.simbolo || "?")} a las ${hora(o.hora)} UTC: ${esc(o.motivo || "sin motivo")}.`]);
      }
      if (salud.comite_segundos && salud.comite_segundos.maximo > 240) {
        a.push(["aviso", `El comité llegó a tardar ${salud.comite_segundos.maximo} s en 24 h; el servicio espera a n8n hasta 330 s.`]);
      }
    }
    for (const o of d.cerradas) {
      if (o.r_simulado == null || ahora - Date.parse(o.cierre) > 24 * 3600e3) continue;
      if (Math.abs(o.r - o.r_simulado) >= 0.5) {
        a.push(["info", `${esc(o.simbolo)} de las ${hora(o.apertura)} UTC: ${R(o.r)} en real y ${R(o.r_simulado)} simulada. La diferencia viene de la ejecución (ver el historial).`]);
      }
    }
    return a;
  }
  function estadoGeneral(lista_) {
    const mal = lista_.filter((x) => x[0] === "mal").length, aviso = lista_.filter((x) => x[0] === "aviso").length;
    if (mal) return ["mal", `${mal} fallo${mal > 1 ? "s" : ""}`];
    if (aviso) return ["aviso", `${aviso} aviso${aviso > 1 ? "s" : ""}`];
    return ["ok", "Todo en orden"];
  }

  // ---- Barra superior --------------------------------------------------------------------------------------------
  function barra(d, ahora) {
    const fecha_ = new Date(ahora);
    let estado = ["info", "Cargando"];
    if (d) estado = estadoGeneral(avisos(d, ahora));
    else if (errorCarga) estado = ["mal", "Sin datos"];
    const proxima = proximaVotacion(ahora);
    const proximaTexto = proxima == null ? "—"
      : `${proxima - ahora < 3 * 3600e3 ? "" : `${fDiaUTC.format(new Date(proxima))} `}${new Date(proxima).toISOString().slice(11, 16)} UTC`;
    return `
      <div class="marca"><h1>Comité de IAs</h1><span class="pastilla ${estado[0]}">${estado[1]}</span></div>
      <div class="relojes">
        <div class="reloj"><b>${reloj(fecha_, true)}</b><span>UTC</span></div>
        <div class="reloj local"><b>${reloj(fecha_, false)}</b><span>Local · ${esc(zonaLocal)}</span></div>
      </div>
      <div class="datos-barra">
        <span>CME <b>${(() => { const c = cierreCME(ahora); return c ? `cerrado · ${c.motivo}` : "abierto"; })()}</b></span>
        <span>Próxima votación <b>${proximaTexto}</b>${proxima ? ` · en ${duracion(proxima - ahora + 30e3)}` : ""}</span>
        ${d ? `<span>Modo <b>${d.sistema.modo === "real" ? "real" : "prueba"}</b></span><span>Datos <b>${hace(d.generado, ahora)}</b></span>` : ""}
      </div>`;
  }

  // ---- 1. Estado ---------------------------------------------------------------------------------------------------
  function seccionEstado(d, ahora) {
    const a = avisos(d, ahora), s = d.salud, sis = d.sistema, u = sis.ultimo_ciclo;
    const lista_ = a.length
      ? `<ul class="avisos">${a.map(([nivel, texto]) => `<li class="${nivel}"><span class="pastilla ${nivel}">${{ mal: "fallo", aviso: "aviso", info: "info" }[nivel]}</span><span>${texto}</span></li>`).join("")}</ul>`
      : '<p class="sin-avisos">Sin incidencias en las últimas 24 horas.</p>';
    const c = cierreCME(ahora);
    const cerrado = c ? `<p class="mercado-cerrado"><b>Mercado cerrado: ${c.motivo}.</b> CME reabre ${c.reabre - ahora < 20 * 3600e3 ? "a las" : "el"} ${cuando(c.reabre, ahora)}, dentro de ${duracion(c.reabre - ahora)}.
      Mientras tanto el servicio hace su ciclo cada hora, pero no vota: no es un fallo.</p>` : "";
    let horas = "";
    if (s) {
      const celdas = s.horas.map((h) => {
        const cerradaYNormal = !h.mercado_abierto && h.estado === "rutina";
        const clase_ = h.estado === "falta" && !h.mercado_abierto ? "falta-cerrado" : cerradaYNormal ? "cerrado" : h.estado;
        const detalle = [`${fecha(h.hora)} UTC: ${cerradaYNormal ? "mercado cerrado, no se vota" : ESTADO_HORA[h.estado]}`];
        if (h.votadas) detalle.push(`${h.votadas} símbolo${h.votadas > 1 ? "s" : ""} votado${h.votadas > 1 ? "s" : ""}`);
        if (h.fallos) detalle.push(`${h.fallos} voto${h.fallos > 1 ? "s" : ""} fallido${h.fallos > 1 ? "s" : ""}`);
        if (h.problemas.length) detalle.push(h.problemas.join("; "));
        return `<div class="hora ${clase_}" title="${esc(detalle.join(" · "))}"></div>`;
      }).join("");
      const eje = s.horas.map((h, i) => `<span>${i % 3 === 0 ? hora(h.hora).slice(0, 2) : ""}</span>`).join("");
      const ciclo = u
        ? `Último ciclo de esta sesión del servicio: ${hora(u.inicio)} UTC${u.fin ? `, ${Math.round((Date.parse(u.fin) - Date.parse(u.inicio)) / 1000)} s` : ""}${u.fases_con_fallo.length ? `, con fallo en ${esc(u.fases_con_fallo.join(", "))}` : ", sin fallos"}.`
        : "El servicio se ha reiniciado y aún no ha hecho ningún ciclo: es normal hasta la próxima hora.";
      horas = `
        <div class="tarjeta c7">
          <h3>Ciclos de las últimas 24 horas (UTC)</h3>
          <div class="horas">${celdas}</div><div class="horas-eje">${eje}</div>
          <div class="leyenda">
            <span><i class="hora voto"></i>votó</span><span><i class="hora cerrado"></i>mercado cerrado</span>
            <span><i class="hora rutina"></i>sin votar por rutina</span><span><i class="hora problema"></i>problema</span>
            <span><i class="hora comite_caido"></i>comité caído o sin ciclo</span>
          </div>
          <p class="nota">
            ${s.comite_segundos ? `El comité tarda ${s.comite_segundos.mediana} s de mediana (máximo ${s.comite_segundos.maximo} s). ` : ""}
            Órdenes enviadas: ${s.ordenes.enviadas}. MT5 ${sis.mt5.conectado ? "conectado" : "<b class=neg>desconectado</b>"},
            trading algorítmico ${sis.mt5.trading_algoritmico ? "activo" : "<b class=neg>desactivado</b>"}. ${ciclo}
          </p>
        </div>
        <div class="tarjeta c5">
          <h3>IAs en las últimas 24 horas</h3>
          <div class="tabla"><table>
            <thead><tr><th>IA</th><th>Proveedor</th><th class="num">Votos</th><th class="num">Fallos</th></tr></thead>
            <tbody>${s.por_ia.map((x) => `<tr>
              <td>${ia(x.familia, x.modelo)}</td><td class="mono">${esc(x.proveedor)}</td><td class="num">${x.votos}</td>
              <td class="num ${x.fallos ? "neg" : ""}" title="${esc(x.tipos.map((t) => `${t.n} ${t.tipo} en ${t.proveedor}, el último ${fecha(t.ultimo)} UTC`).join("; "))}">${x.fallos}${
                x.tipos.some((t) => t.proveedor !== x.proveedor) ? `<br><span class="tenue mono">en ${esc([...new Set(x.tipos.map((t) => t.proveedor))].join(", "))}</span>` : ""}</td>
            </tr>`).join("")}</tbody>
          </table></div>
        </div>`;
    }
    return `
      <section class="seccion" id="estado">
        <header><h2>Estado</h2><p>¿Hay algo roto o algo que tenga que hacer yo?</p></header>
        <div class="rejilla"><div class="tarjeta c12">${cerrado}${lista_}</div>${horas}</div>
      </section>`;
  }

  // ---- 2. Ahora ------------------------------------------------------------------------------------------------
  function seccionAhora(d, ahora) {
    const abiertas = d.abiertas.length ? `<div class="tabla"><table>
      <thead><tr><th>Símbolo</th><th>Lado</th><th>Abierta</th><th>Cierre por tiempo</th><th class="num">Resultado</th><th class="num">Al stop</th><th class="num">Al objetivo</th><th>Votos</th></tr></thead>
      <tbody>${d.abiertas.map((p) => {
        const f = p.r_flotante;
        return `<tr><td><b>${esc(p.simbolo)}</b></td><td>${lado(p.lado)}</td><td>${fecha(p.apertura)}</td>
          <td>${hora(p.cierre_previsto)} <span class="tenue">· en ${duracion(Date.parse(p.cierre_previsto) - ahora)}</span></td>
          <td class="num">${R(f)}</td><td class="num">${f == null ? "—" : `${num(1 + f)} R`}</td><td class="num">${f == null ? "—" : `${num(1 - f)} R`}</td>
          <td>${p.votos.map((v) => `<span title="${esc(nombre(v.familia))}">${voto(v.opcion)}</span>`).join("")}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="nota">«Al stop» y «al objetivo»: cuánto falta, en R, sin contar la comisión.</p>`
      : '<p class="tenue">Ninguna posición abierta.</p>';

    const vs = d.votaciones;
    const rutina = vs.length && vs.every((v) => v.estado === "sin_votar" && esRutina(v.motivo_sin_votar, v.momento));
    let votacion;
    if (!vs.length) votacion = '<p class="tenue">Aún no hay votaciones.</p>';
    else if (rutina) {
      const ultima = vs.reduce((m, v) => (v.momento > m ? v.momento : m), "");
      const motivos = [...new Set(vs.map((v) => v.motivo_sin_votar.replace(/ en .*$/, "")))];
      votacion = `<p>A las ${hora(ultima)} UTC no se votó en ningún símbolo: ${esc(lista(motivos))}. Es rutina.</p>`;
    } else {
      const familias = d.sistema.comite.map((c) => c.familia);
      votacion = `<div class="tabla"><table>
        <thead><tr><th>Símbolo</th><th>Hora</th>${familias.map((f) => `<th title="${esc(f)}">${esc(nombre(f))}</th>`).join("")}<th class="num">Suma</th><th>Resultado</th></tr></thead>
        <tbody>${vs.map((v) => {
          if (v.estado !== "decidida") {
            return `<tr><td><b>${esc(v.simbolo)}</b></td><td>${hora(v.momento)}</td><td colspan="${familias.length + 2}" class="${esRutina(v.motivo_sin_votar, v.momento) ? "tenue" : "neg"}">sin votar: ${esc(v.motivo_sin_votar || v.estado)}</td></tr>`;
          }
          const por = Object.fromEntries(v.votos.map((x) => [x.familia, x]));
          const orden = v.orden ? ` <span class="tenue">· orden ${esc(v.orden)}</span>`
            : v.sin_orden ? ` <span class="tenue" title="${esc(v.sin_orden)}">· sin orden: ya hay posición</span>` : "";
          return `<tr><td><b>${esc(v.simbolo)}</b></td><td>${hora(v.momento)}</td>${familias.map((f) => `<td>${voto(por[f] && por[f].opcion)}</td>`).join("")}
            <td class="num">${conSigno(v.suma, 0)}</td><td>${RESULTADO[v.resultado] || esc(v.resultado)}${orden}</td></tr>`;
        }).join("")}</tbody></table></div>
        ${vs.filter((v) => v.estado === "decidida").map((v) => `<details><summary>Motivos de ${esc(v.simbolo)} (${hora(v.momento)} UTC)</summary>
          <ul class="motivos">${v.votos.map((x) => `<li>${ia(x.familia, x.modelo)} ${voto(x.opcion)} ${x.opcion ? esc(x.motivo || "") : `<span class="tenue">falló: ${esc(x.fallo || "")}</span>`}</li>`).join("")}</ul></details>`).join("")}`;
    }
    return `
      <section class="seccion" id="ahora">
        <header><h2>Ahora</h2><p>Lo que hay abierto y lo último que se ha votado.</p></header>
        <div class="rejilla">
          <div class="tarjeta c6"><h3>Posiciones abiertas</h3>${abiertas}</div>
          <div class="tarjeta c6"><h3>Última votación de cada símbolo</h3>${votacion}</div>
        </div>
      </section>`;
  }

  // ---- 3. ¿Tiene ventaja? --------------------------------------------------------------------------------------------
  function diasDeMercado(desde, hasta) {
    let horas = 0;
    for (let t = desde; t < hasta; t += 3600e3) if (sesionCME(t) === "abierto") horas++;
    return horas / 23;
  }
  function seccionVentaja(d, ahora) {
    const r = d.rendimiento, sim = d.simulado, frente = r.frente_a_simulado || { curva: [], operaciones: 0, diferencia_media: null };
    const cifras = [
      ["Operaciones", num(r.operaciones, 0), `${r.abiertas} abierta${r.abiertas === 1 ? "" : "s"}`],
      ["Resultado", R(r.r_total), `${conSigno(r.rentabilidad_pct, 2)} % de la cuenta`],
      ["Por operación", R(r.r_medio), r.error_tipico != null ? `± ${num(r.error_tipico)} R de error típico` : "pocas operaciones"],
      ["Acierto", r.acierto_pct == null ? "—" : `${num(r.acierto_pct, 0)} %`, `profit factor ${num(r.profit_factor)}`],
      ["Caída máxima", r.caida_maxima_pct == null ? "—" : `${num(r.caida_maxima_pct, 2)} %`, "de la cuenta"],
    ].map(([t, v, n]) => `<div class="cifra"><span>${t}</span><b>${v}</b><small>${n}</small></div>`).join("");

    // Cuánto falta para saber si hay ventaja: con 1:1, el error típico del R medio es σ/√n
    const comite = sim.referencias.find((x) => x.nombre === "Comité");
    const n = r.operaciones;
    const sigma = n >= 30 && r.error_tipico ? r.error_tipico * Math.sqrt(n) : 1;
    const hacenFalta = Math.ceil((2 * sigma / VENTAJA_BUSCADA) ** 2);
    const inicio = Date.parse(d.sistema.en_real_desde || r.desde || d.generado);
    const dias = diasDeMercado(inicio, ahora);
    const ritmo = dias >= 0.5 ? n / dias : null;
    const semanas = ritmo ? (hacenFalta - n) / ritmo / 5 : null;
    const saber = `
      <h3>¿Cuándo se sabrá?</h3>
      <p>Para distinguir una ventaja de ${conSigno(VENTAJA_BUSCADA)} R por operación (a dos errores típicos) hacen falta unas
        <b>${num(hacenFalta, 0)} operaciones</b>. Van ${n}.</p>
      <div class="progreso"><span style="width:${Math.min(100, (100 * n) / hacenFalta)}%"></span></div>
      <p class="nota">${ritmo ? `Al ritmo actual, ${num(ritmo, 1)} operaciones por día de mercado: unas ${num(Math.max(0, semanas), 0)} semanas más.` : "Aún no hay ritmo."}
        ${n < 30 ? "Hasta tener 30 operaciones se supone una desviación de 1 R por operación." : ""}</p>`;

    const filas = [
      ["Real", "lo que se ha ejecutado", { operaciones: n, r_medio: r.r_medio, error_tipico: r.error_tipico, r_total: r.r_total }],
      ...sim.referencias.map((x) => [x.nombre === "Comité" ? "Comité, simulado" : x.nombre, x.descripcion, { operaciones: x.votos, r_medio: x.r_medio, error_tipico: x.error_tipico, r_total: x.r_total }]),
    ];
    const comparacion = `
      <div class="tabla"><table>
        <thead><tr><th></th><th class="num">Operaciones</th><th class="num">R por operación</th><th class="num">R total</th></tr></thead>
        <tbody>${filas.map(([nombre_, desc, m]) => `<tr><td title="${esc(desc)}"><b>${esc(nombre_)}</b><br><span class="tenue">${esc(desc)}</span></td>
          <td class="num">${m.operaciones}</td><td class="num">${conError(m.r_medio, m.error_tipico)}</td><td class="num">${R(m.r_total)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="nota">Las simuladas cuentan cada señal de las ${sim.votaciones} votaciones puntuadas, aunque se solapen, con stop y objetivo a 1,5 ATR, cierre a las 4 h, y spread y comisión descontados.
        «Al azar» es la media de comprar y vender: lo que da no tener ventaja. ${comite && comite.votos !== n ? "La real y la simulada no tienen las mismas operaciones: la simulación cuenta también las señales con una posición ya abierta." : ""}</p>`;

    const difMedia = frente.diferencia_media;
    const salidas = tablaSalidas(d);
    return `
      <section class="seccion" id="ventaja">
        <header><h2>¿Tiene ventaja?</h2><p>Desde la puesta en real, el ${fecha(d.sistema.en_real_desde)} UTC. Todo en R: 1 R es lo que se arriesga hasta el stop.</p></header>
        <div class="cifras">${cifras}</div>
        <div class="rejilla" style="margin-top:12px">
          <div class="tarjeta c7">
            <h3>Resultado acumulado, real y simulado</h3>
            <div class="grafica" data-grafica="frente"></div>
            <p class="nota">Cada operación real frente a la misma operación simulada desde su votación.
              ${difMedia != null ? `De media, la real sale ${R(difMedia, 3)} por operación respecto a la simulada (${frente.operaciones} operaciones): es lo que cuesta, o da, ejecutar un minuto después y al precio del broker.` : ""}</p>
          </div>
          <div class="tarjeta c5">${saber}</div>
          <div class="tarjeta c12"><h3>Frente a las referencias</h3>${comparacion}</div>
          ${salidas}
        </div>
      </section>`;
  }

  // ¿Otra salida? Las alternativas se simulan en cada votación pero no se operan (0037)
  const significativa = (f) => f && f.error_tipico && Math.abs(f.r_medio) > 2 * f.error_tipico;
  function tablaSalidas(d) {
    const s = d.salidas;
    if (!s || !s.grupos.some((g) => g.operaciones)) return "";
    const titulo = { comite: "Operaciones del comité", senales: "Todas las señales (1 voto o más)" };
    const tabla = (g) => `<div class="tarjeta c6"><h3>${titulo[g.nombre] || esc(g.nombre)} · ${g.operaciones}</h3>
      <div class="tabla"><table>
        <thead><tr><th>Salida</th><th class="num">R por operación</th><th class="num">Frente a la actual</th><th class="num">Ganadoras</th></tr></thead>
        <tbody>${g.variantes.map((v) => {
          const f = v.frente_a_actual;
          const cuantas = v.comparadas != null && v.comparadas !== g.operaciones
            ? ` <span class="tenue" title="Operaciones con alguna votación después: solo en ellas puede actuar, y solo en ellas se compara con la actual">(${v.comparadas})</span>` : "";
          return `<tr class="${v.clave === "actual" ? "actual" : ""}"><td title="${esc((SALIDAS[v.clave] || ["", ""])[1])}">${esc(salidaCorta(v.clave))}${cuantas}</td>
            <td class="num">${conError(v.r_medio, v.error_tipico)}</td>
            <td class="num">${f ? `<span class="${significativa(f) ? "marca-dif" : ""}">${conError(f.r_medio, f.error_tipico)}</span>` : "—"}</td>
            <td class="num">${v.acierto_pct == null ? "—" : `${num(v.acierto_pct, 0)} %`}</td></tr>`;
        }).join("")}</tbody>
      </table></div></div>`;
    // ¿Aporta el voto? Lo que da cerrar en cada hora con la posición abierta, según el comité la siga apoyando o no (0039)
    const conHoras = s.grupos.filter((g) => g.aporta_el_voto && (g.aporta_el_voto.apoya.horas || g.aporta_el_voto.no_apoya.horas));
    const celda = (x) => (x.horas ? `${conError(x.r_medio, x.error_tipico)} <span class="tenue">(${x.horas} h)</span>` : "—");
    const voto_ = conHoras.length ? `<div class="tarjeta c12"><h3>¿Aporta el voto del comité?</h3>
      <div class="tabla"><table>
        <thead><tr><th></th><th class="num">Cerrar cuando la sigue apoyando</th><th class="num">Cerrar cuando ya no la apoya</th></tr></thead>
        <tbody>${conHoras.map((g) => `<tr><td>${titulo[g.nombre] || esc(g.nombre)}</td><td class="num">${celda(g.aporta_el_voto.apoya)}</td>
          <td class="num">${celda(g.aporta_el_voto.no_apoya)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="nota">Lo que da cerrar en cada hora con la posición abierta, frente a la salida actual, según el comité la siga apoyando (suma a su favor de 1 o más) o no.
        Si cerrar ayuda más cuando ya no la apoya, el voto aporta; si ayuda igual en los dos casos, lo que ayuda es salir antes.
        Las horas de una misma operación no son independientes: el error real es mayor.</p></div>` : "";
    return `${s.grupos.filter((g) => g.operaciones).map(tabla).join("")}${voto_}
      <div class="nota" style="grid-column: span 12; margin-top: -4px">
        <p><b>¿Otra salida?</b> Cada votación se simula también con estas salidas, con el mismo stop inicial, la misma comisión y cierre a las 4 h como mucho.
          No se operan. «Frente a la actual» compara las mismas operaciones una a una; se resalta cuando la diferencia pasa de dos errores típicos.
          «Sin apoyo» y «En contra» solo pueden actuar si hubo alguna votación después, y solo ahí se comparan con la actual (entre paréntesis, en cuántas): hasta el 5/10 no se votaba con una posición abierta.
          Se decidirá con unas 100 operaciones del comité.</p>
        <p>${Object.values(SALIDAS).slice(1).map(([corto, largo]) => `<b>${esc(corto)}</b>: ${esc(largo)}`).join(". ")}.
          El stop que se mueve vale desde el minuto siguiente.</p>
      </div>`;
  }

  // ---- 4. El comité por dentro ----------------------------------------------------------------------------------------
  function participacion(d) {
    return d.por_ia.map((x) => {
      const v = x.votos, validos = v.COMPRAR + v.VENDER + v.NADA, dir = v.COMPRAR + v.VENDER;
      return { familia: x.familia, modelo: x.modelo, v, validos, dir, total: validos + v.FALLO, cuota: validos ? dir / validos : null };
    });
  }
  function hallazgos(d) {
    const c = d.comite, h = [];
    if (!c || !c.votaciones) return h;
    const dir = c.pares.reduce((s, p) => s + p.direccionales, 0), contra = c.pares.reduce((s, p) => s + p.contrarios, 0);
    if (dir) {
      h.push(contra === 0
        ? `<b>Las IAs no se han contradicho nunca.</b> En ${dir} ocasiones en que dos de ellas votaron comprar o vender a la vez, coincidieron siempre. El desacuerdo es solo entre operar o no hacer nada: la suma mide convicción, no un debate.`
        : `<b>Las IAs casi no se contradicen:</b> de ${dir} ocasiones en que dos votaron comprar o vender a la vez, chocaron ${contra} (${pct(contra / dir)}).`);
    }
    const p = participacion(d);
    const poco = p.filter((x) => x.validos >= 20 && x.cuota < 0.15), resto = p.filter((x) => !poco.includes(x));
    if (poco.length) {
      const umbral = c.umbral_actual;
      poco.sort((a, b) => a.cuota - b.cuota);
      h.push(`<b>${lista(poco.map((x, i) => i === 0
        ? `${nombre(x.familia)} solo se ha mojado en ${x.dir} de ${x.validos} votaciones (${pct(x.cuota)})`
        : `${nombre(x.familia)}, en ${x.dir} de ${x.validos} (${pct(x.cuota)})`))}.</b>
        En la práctica deciden ${lista(resto.map((x) => nombre(x.familia)))}${resto.length === umbral ? `: con el umbral en ${umbral}, tienen que estar las ${umbral} de acuerdo` : ""}.`);
    }
    const us = c.umbrales.filter((u) => u.operaciones > 0);
    if (us.length >= 2) {
      const sube = us.every((u, i) => i === 0 || u.r_medio > us[i - 1].r_medio);
      const actual = us.find((u) => u.umbral === c.umbral_actual);
      h.push(`<b>${sube ? "Cuantas más IAs de acuerdo, mejor resultado por operación" : "El resultado según cuántas IAs coincidan"}:</b>
        ${us.map((u) => `${u.umbral} voto${u.umbral > 1 ? "s" : ""}, ${R(u.r_medio)} (${u.operaciones})`).join(" · ")}.
        ${actual && actual.operaciones < 100 ? "Con tan pocas operaciones todavía es ruido, pero es la tabla que dirá si el umbral está bien." : ""}`);
    }
    const g = d.salidas && d.salidas.grupos.find((x) => x.nombre === "comite");
    if (g && g.operaciones >= 30) {
      for (const v of g.variantes.filter((x) => significativa(x.frente_a_actual))) {
        const f = v.frente_a_actual;
        h.push(`<b>La salida «${esc(salidaCorta(v.clave))}» ${f.r_medio > 0 ? "mejora" : "empeora"} la actual en ${num(Math.abs(f.r_medio))} R por operación</b>
          (± ${num(f.error_tipico)}, ${g.operaciones} operaciones del comité): más del doble de su error típico.`);
      }
    }
    return h;
  }
  function seccionComite(d) {
    const c = d.comite;
    const h = hallazgos(d);
    const p = participacion(d);
    const barras = `<div class="tabla"><table>
      <thead><tr><th>IA</th><th>Votos desde la puesta en real</th><th class="num">Se moja</th><th class="num">▲ / ▼</th><th class="num">Fallos</th></tr></thead>
      <tbody>${p.map((x) => `<tr><td>${ia(x.familia, x.modelo)}</td>
        <td><div class="barra-votos" title="${x.v.COMPRAR} comprar · ${x.v.VENDER} vender · ${x.v.NADA} nada · ${x.v.FALLO} fallos">${["COMPRAR", "VENDER", "NADA", "FALLO"].map((k) => `<span class="${k}" style="width:${x.total ? (100 * x.v[k]) / x.total : 0}%"></span>`).join("")}</div></td>
        <td class="num">${pct(x.cuota)}</td><td class="num">${x.v.COMPRAR} / ${x.v.VENDER}</td><td class="num">${x.v.FALLO}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="nota">«Se moja»: de sus votos válidos, cuántos son comprar o vender. Verde, comprar; rojo, vender; gris, nada; ámbar, fallo.</p>`;

    const familias = d.sistema.comite.map((x) => x.familia);
    const par = (a, b) => c.pares.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    const matriz = `<div class="tabla"><table class="matriz">
      <thead><tr><th></th>${familias.slice(1).map((f) => `<th>${esc(nombre(f))}</th>`).join("")}</tr></thead>
      <tbody>${familias.slice(0, -1).map((a, i) => `<tr><th>${esc(nombre(a))}</th>${familias.slice(1).map((b, j) => {
        if (j < i) return '<td class="diag"></td>';
        const x = par(a, b);
        if (!x || !x.votaciones) return "<td>—</td>";
        const arriba = x.direccionales ? `<span class="${x.contrarios ? "neg" : ""}">${x.direccionales - x.contrarios}/${x.direccionales}</span>` : '<span class="tenue">0</span>';
        return `<td title="${x.direccionales} veces votaron las dos comprar o vender; chocaron ${x.contrarios}. Mismo voto en ${x.iguales} de ${x.votaciones}.">${arriba}<small>${pct(x.iguales / x.votaciones)} igual</small></td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="nota">Arriba: de las veces que las dos votaron comprar o vender a la vez, en cuántas coincidieron. Abajo: votaciones con el mismo voto, «nada» incluido.</p>`;

    const umbrales = `<div class="tabla"><table>
      <thead><tr><th>Votos para operar</th><th class="num">Operaciones</th><th class="num">R por operación</th><th class="num">R total</th><th class="num">Acierto</th></tr></thead>
      <tbody>${c.umbrales.map((u) => `<tr class="${u.umbral === c.umbral_actual ? "actual" : ""}"><td>${u.umbral}${u.umbral === c.umbral_actual ? " (el actual)" : ""}</td>
        <td class="num">${u.operaciones}</td><td class="num">${conError(u.r_medio, u.error_tipico)}</td><td class="num">${R(u.r_total)}</td>
        <td class="num">${u.acierto_pct == null ? "—" : `${num(u.acierto_pct, 0)} %`}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="nota">Qué habría dado operar cada señal con al menos esos votos en el mismo sentido, con la simulación de las ${c.votaciones} votaciones puntuadas.</p>`;

    const aporta = Object.fromEntries(c.aportacion.map((x) => [x.familia, x]));
    // El color de «El comité sin ella» no es el signo de su R: es si el comité, en R total, habría ido peor sin ella
    // (verde: aporta) o mejor (rojo)
    const real = (c.umbrales.find((u) => u.umbral === c.umbral_actual) || { r_total: 0 }).r_total;
    const sinElla = (s) => {
      if (!s.operaciones) return "0";
      const dif = s.r_total - real;
      return `${s.operaciones} · <span class="${clase(-dif)}" title="Sin ella, ${conSigno(s.r_total)} R en total; con ella, ${conSigno(real)} R">${conSigno(s.r_medio)} R</span>`;
    };
    const porIA = `<div class="tabla"><table>
      <thead><tr><th>IA</th><th class="num">Votos ▲▼</th><th class="num">R por voto</th><th class="num">R total</th><th class="num">Acierto</th>
        <th class="num">«Nada» bien</th><th class="num">Disponible</th><th class="num">Decisiva en</th><th class="num">El comité sin ella</th></tr></thead>
      <tbody>${d.simulado.por_ia.map((x) => {
        const a = aporta[x.familia] || { decisiva: {}, sin_ella: {} };
        const pequena = x.votos < 30 ? ' class="pequena" title="Menos de 30 votos: todavía es ruido"' : "";
        return `<tr><td>${ia(x.familia, x.modelo)}</td><td class="num">${x.votos}</td><td class="num"${pequena}>${conError(x.r_medio, x.error_tipico)}</td>
          <td class="num">${R(x.r_total)}</td><td class="num">${x.acierto_pct == null ? "—" : `${num(x.acierto_pct, 0)} %`}</td>
          <td class="num">${x.nada_bien_pct == null ? "—" : `${num(x.nada_bien_pct, 0)} %`}</td><td class="num">${x.disponibilidad_pct == null ? "—" : `${num(x.disponibilidad_pct, 0)} %`}</td>
          <td class="num">${a.decisiva.operaciones ? `${a.decisiva.operaciones} · ${R(a.decisiva.r_total)}` : "0"}</td>
          <td class="num">${sinElla(a.sin_ella)}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="nota">Cada voto de comprar o vender, simulado sobre las velas de 1 minuto se ejecute o no. «Nada» bien: de sus «nada», en cuántos ninguna dirección llegó al objetivo.
      Decisiva: operaciones del comité que sin su voto no se habrían hecho, y lo que dieron. El comité sin ella: las operaciones que habría hecho con las otras cuatro y el mismo umbral, y su R por operación;
      en verde si sin ella habría ganado menos en total (aporta), en rojo si habría ganado más.</p>`;

    // Lo que cuesta cada IA (0038), junto a lo que aporta. El coste es dinero real; el R, simulado y de una cuenta
    // virtual: no se pasa de uno a otro.
    const k = d.costes;
    const porCoste = !k ? '<p class="tenue">Aún no hay datos de coste de OpenRouter.</p>' : `<div class="tabla"><table>
      <thead><tr><th>IA</th><th class="num">Al mes</th><th class="num">Del gasto</th><th class="num">Por votación</th>
        <th class="num">Votos ▲▼</th><th class="num">Por voto ▲▼</th><th class="num">Aporte al comité</th></tr></thead>
      <tbody>${k.por_ia.map((x) => {
        const a = aporta[x.familia];
        const aporte = a && a.sin_ella.operaciones != null ? R(real - a.sin_ella.r_total) : "—";
        const t = x.tokens_por_peticion;
        const detalle = t ? `${x.peticiones} peticiones para ${x.votos} votaciones; por petición, ${num(t.entrada, 0)} tokens de entrada, ${num(t.salida, 0)} de salida y ${num(t.razonamiento, 0)} de razonamiento` : "";
        return `<tr><td>${ia(x.familia, x.modelo)}</td><td class="num"><b>${dolares(x.al_mes_usd)}</b></td>
          <td class="num">${x.cuota == null ? "—" : pct(x.cuota)}</td>
          <td class="num" title="${esc(detalle)}">${dolares(x.por_votacion_usd)}</td><td class="num">${x.direccionales}</td>
          <td class="num">${dolares(x.por_voto_direccional_usd)}</td><td class="num">${aporte}</td></tr>`;
      }).join("")}
        <tr class="total"><td><b>Comité</b></td><td class="num"><b>${dolares(k.al_mes_usd)}</b></td><td class="num">100 %</td>
          <td colspan="4"></td></tr></tbody>
    </table></div>
    <p class="nota">Coste de OpenRouter del ${dia(k.desde)} al ${dia(k.hasta)} (${k.dias} días enteros, ${k.horas_de_mercado} horas de mercado, ${dolares(k.total_usd)}),
      llevado a las horas de mercado de 30 días: el fin de semana casi no se vota.
      Por votación: lo que cuesta cada vez que se le pregunta, fallos incluidos. Por voto ▲▼: el coste entre sus votos de comprar o vender, los que mueven la suma.
      Aporte: el R simulado del comité real menos el del comité sin ella. El coste es dinero real; el R, de una cuenta virtual, así que no se comparan en la misma unidad.
      ${k.otros_usd >= 0.005 ? `Otros modelos de la cuenta de OpenRouter: ${dolares(k.otros_usd)}.` : ""}</p>`;

    return `
      <section class="seccion" id="comite">
        <header><h2>El comité por dentro</h2><p>¿Funciona como comité? ¿Qué aporta cada IA y está bien el umbral?</p></header>
        <div class="rejilla">
          <div class="tarjeta c7"><h3>Lo que dicen los datos</h3>${h.length ? `<ul class="hallazgos">${h.map((x) => `<li>${x}</li>`).join("")}</ul>` : '<p class="tenue">Aún no hay votaciones puntuadas.</p>'}</div>
          <div class="tarjeta c5"><h3>El umbral</h3>${umbrales}</div>
          <div class="tarjeta c6"><h3>Cuánto se moja cada IA</h3>${barras}</div>
          <div class="tarjeta c6"><h3>Coincidencias entre IAs</h3>${matriz}</div>
          <div class="tarjeta c12"><h3>Cada IA, simulada</h3>${porIA}</div>
          <div class="tarjeta c12"><h3>Lo que cuesta cada IA</h3>${porCoste}</div>
        </div>
      </section>`;
  }

  // ---- 5. Historial ------------------------------------------------------------------------------------------------
  function seccionHistorial(d) {
    const umbral = d.sistema.reglas.umbral_votos;
    const cerradas = d.cerradas.length ? `<div class="tabla"><table>
      <thead><tr><th>Abierta</th><th>Símbolo</th><th>Lado</th><th class="num">Entrada</th><th>Cierre</th><th>Por</th><th class="num">Real</th><th class="num">Simulada</th><th class="num">Diferencia</th></tr></thead>
      <tbody>${[...d.cerradas].sort((a, b) => b.apertura.localeCompare(a.apertura)).map((o) => {
        const dif = o.r_simulado == null ? null : o.r - o.r_simulado;
        const simulada = o.r_simulado == null ? '<span class="tenue">pendiente</span>' : `${R(o.r_simulado)}${o.salida_simulada !== o.motivo_cierre ? ` <span class="tenue">(${CIERRE[o.salida_simulada] || esc(o.salida_simulada)})</span>` : ""}`;
        return `<tr><td>${fecha(o.apertura)}</td><td><b>${esc(o.simbolo)}</b></td><td>${lado(o.lado)}</td>
          <td class="num" title="Segundos desde la votación hasta la orden">${o.segundos_entrada == null ? "—" : `${o.segundos_entrada} s`}</td>
          <td>${fecha(o.cierre)}</td><td>${CIERRE[o.motivo_cierre] || esc(o.motivo_cierre)}</td><td class="num">${R(o.r)}</td><td class="num">${simulada}</td>
          <td class="num">${dif == null ? "—" : `<span class="${Math.abs(dif) >= 0.5 ? "marca-dif" : ""}">${conSigno(dif)}</span>`}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="nota">Entrada: segundos desde la votación hasta la orden. Simulada: la misma operación desde los niveles de la votación; entre paréntesis, si salió por otro motivo.</p>`
      : '<p class="tenue">Aún no hay operaciones cerradas.</p>';

    const senales = d.senales.length ? `<div class="tabla"><table>
      <thead><tr><th>Hora</th><th>Símbolo</th><th class="num">Suma</th><th>Qué pasó</th><th class="num">Simulada</th></tr></thead>
      <tbody>${d.senales.map((s) => {
        const opero = Math.abs(s.suma) >= umbral;
        const sentido = s.suma > 0 ? '<span class="pos">▲</span>' : '<span class="neg">▼</span>';
        return `<tr class="${opero ? "" : "casi"}"><td>${fecha(s.momento)}</td><td><b>${esc(s.simbolo)}</b></td><td class="num">${sentido} ${conSigno(s.suma, 0)}</td>
          <td>${opero ? `${RESULTADO[s.resultado] || esc(s.resultado)}${s.orden ? `, orden ${esc(s.orden)}` : s.sin_orden ? ", sin orden: ya había posición" : ""}` : "a un voto: no operó"}</td>
          <td class="num">${R(s.r_simulado)}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="nota">Las votaciones que operaron y las que se quedaron a un voto (en gris), con lo que dio o habría dado la operación simulada.</p>`
      : '<p class="tenue">Aún no hay señales.</p>';

    const simbolos = `<div class="tabla"><table>
      <thead><tr><th>Símbolo</th><th class="num">Operaciones</th><th class="num">Acierto</th><th class="num">R total</th><th class="num">Cuenta</th></tr></thead>
      <tbody>${d.por_simbolo.map((s) => `<tr><td><b>${esc(s.simbolo)}</b></td><td class="num">${s.operaciones}</td>
        <td class="num">${s.acierto_pct == null ? "—" : `${num(s.acierto_pct, 0)} %`}</td><td class="num">${R(s.r_total)}</td>
        <td class="num">${s.operaciones ? `${conSigno(s.rentabilidad_pct)} %` : "—"}</td></tr>`).join("")}</tbody></table></div>`;

    const actuales = Object.fromEntries((d.salud ? d.salud.por_ia : []).map((x) => [x.familia, x.proveedor]));
    const cambios = d.sistema.comite.map((m) => {
      const suyos = d.cambios.filter((x) => x.familia === m.familia);
      const filas = suyos.map((x) => `<li><span class="mono">${esc(x.proveedor)}</span> <span class="tenue">· ${fecha(x.desde)} → ${fecha(x.hasta)} · ${x.votos} votos</span></li>`);
      if (actuales[m.familia] && !suyos.some((x) => x.proveedor === actuales[m.familia])) {
        filas.push(`<li><span class="mono">${esc(actuales[m.familia])}</span> <span class="tenue">· desde la próxima votación</span></li>`);
      }
      return `<tr><td>${ia(m.familia, m.modelo)}<br><span class="tenue mono">${esc(m.modelo)}</span></td><td class="ancho"><ul class="motivos">${filas.join("")}</ul></td></tr>`;
    }).join("");

    return `
      <section class="seccion" id="historial">
        <header><h2>Historial</h2></header>
        <div class="rejilla">
          <div class="tarjeta c12"><h3>Operaciones cerradas (las últimas ${d.cerradas.length})</h3>${cerradas}</div>
          <div class="tarjeta c7"><h3>Señales</h3>${senales}</div>
          <div class="tarjeta c5"><h3>Por símbolo</h3>${simbolos}
            <h3 style="margin-top:16px">Modelos y proveedores</h3>
            <div class="tabla"><table><tbody>${cambios}</tbody></table></div>
            <p class="nota">Con qué proveedor ha votado cada IA desde la puesta en real. Un cambio de proveedor puede cambiar el votante: no mezcles etapas al compararlas.</p>
          </div>
        </div>
      </section>`;
  }

  function pie(d) {
    const s = d.sistema, r = s.reglas;
    return `
      <details><summary>Cómo funciona</summary>
        <dl>
          <dt>El comité</dt><dd>${d.sistema.comite.map((m) => `${esc(nombre(m.familia))} <span class="mono tenue">${esc(m.modelo)}</span>`).join(" · ")}</dd>
          <dt>Cuándo</dt><dd>Cada hora, al cierre de la vela, en ${esc(lista(s.simbolos))}. Cada IA vota sin ver a las demás: comprar +1, vender −1, nada 0. Con ${r.umbral_votos} o más en el mismo sentido, se opera.</dd>
          <dt>La operación</dt><dd>A mercado, con stop a ${num(r.sl_atr, 1)} ATR de H1 y objetivo a ${num(r.tp_atr, 1)} ATR, y cierre a las ${num(r.horizonte_horas, 0)} h si no toca ninguno. No se vota con 4 h o menos hasta el cierre del viernes.</dd>
          <dt>El riesgo</dt><dd>${num(r.riesgo_por_operacion_pct, 1)} % de la cuenta hasta el stop. Una posición por símbolo como mucho; mientras hay una abierta, ese símbolo no se vota.</dd>
        </dl>
      </details>
      <p>Cuenta virtual de Darwinex Zero. Solo se publican % y R, sin dinero ni datos de la cuenta. Nada de esto es una recomendación de inversión.</p>
      <p class="tenue">Datos del ${fecha(d.generado)} UTC · código ${esc(s.version_codigo || "—")} · en real desde el ${fecha(s.en_real_desde)} UTC</p>`;
  }

  // ---- Gráfica: real y simulado acumulados, por número de operación -----------------------------------------------
  function dibujarGraficas() {
    if (!datos) return;
    for (const caja of document.querySelectorAll('[data-grafica="frente"]')) {
      const curva = (datos.rendimiento.frente_a_simulado || { curva: [] }).curva;
      if (curva.length < 2) { caja.innerHTML = '<p class="tenue">Hacen falta al menos dos operaciones.</p>'; continue; }
      const ancho = Math.max(280, caja.clientWidth), alto = 220, m = { i: 40, d: 70, a: 10, b: 24 };
      const valores = curva.flatMap((p) => [p.real, p.simulado]).concat(0);
      let min = Math.min(...valores), max = Math.max(...valores);
      const margen = (max - min) * 0.1 || 0.5; min -= margen; max += margen;
      const x = (i) => m.i + (i * (ancho - m.i - m.d)) / curva.length;
      const y = (v) => m.a + ((max - v) * (alto - m.a - m.b)) / (max - min);
      const camino = (k) => [`M${x(0)},${y(0)}`, ...curva.map((p, i) => `L${x(i + 1)},${y(p[k])}`)].join(" ");
      const paso = Math.max(0.25, Math.ceil(((max - min) / 4) * 4) / 4);
      const rayas = [];
      for (let v = Math.ceil(min / paso) * paso; v <= max; v += paso) rayas.push(v);
      const ultimo = curva[curva.length - 1];
      caja.innerHTML = `<svg viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" role="img" aria-label="R acumulado real y simulado">
        ${rayas.map((v) => `<line class="eje" x1="${m.i}" x2="${ancho - m.d}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.i - 6}" y="${y(v) + 4}" text-anchor="end">${conSigno(v, paso < 1 ? 2 : 0)}</text>`).join("")}
        <line class="cero" x1="${m.i}" x2="${ancho - m.d}" y1="${y(0)}" y2="${y(0)}"/>
        <path d="${camino("simulado")}" fill="none" stroke="#8a94a3" stroke-width="2" stroke-dasharray="5 4"/>
        <path d="${camino("real")}" fill="none" stroke="#1f5fbf" stroke-width="2.5"/>
        <text x="${ancho - m.d + 6}" y="${y(ultimo.real) + 4}" style="fill:#1f5fbf;font-weight:600">real ${conSigno(ultimo.real)}</text>
        <text x="${ancho - m.d + 6}" y="${y(ultimo.simulado) + (Math.abs(y(ultimo.simulado) - y(ultimo.real)) < 14 ? 16 : 4)}">simul. ${conSigno(ultimo.simulado)}</text>
        <text x="${m.i}" y="${alto - 6}">operación 1</text><text x="${ancho - m.d}" y="${alto - 6}" text-anchor="end">${curva.length}</text>
      </svg>`;
    }
  }

  // ---- Montaje --------------------------------------------------------------------------------------------------
  function pintarBarra() {
    document.getElementById("barra").innerHTML = barra(datos, Date.now());
  }
  function pintar() {
    const ahora = Date.now();
    const app = document.getElementById("app");
    pintarBarra();
    if (!datos) {
      app.innerHTML = `<p class="cargando">${errorCarga ? `No se pueden leer los datos (${esc(errorCarga)}).` : "Leyendo los datos…"}</p>`;
      return;
    }
    const vivo = fresco(datos, ahora);
    document.body.classList.toggle("alerta", !vivo);
    firmaAlerta = vivo;
    app.innerHTML = `
      ${vivo ? "" : `<div class="banda-alerta" role="alert">Sin noticias del sistema desde el ${fecha(datos.generado)} UTC. Lo de abajo son los últimos datos publicados.</div>`}
      ${seccionEstado(datos, ahora)}${seccionAhora(datos, ahora)}${seccionVentaja(datos, ahora)}${seccionComite(datos)}${seccionHistorial(datos)}`;
    let pieEl = document.querySelector("footer.pie");
    if (!pieEl) { pieEl = document.createElement("footer"); pieEl.className = "pie"; document.body.appendChild(pieEl); }
    pieEl.innerHTML = pie(datos);
    dibujarGraficas();
  }

  async function cargar() {
    let nuevos;
    try {
      const r = await fetch(`datos.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      nuevos = await r.json();
      errorCarga = null;
    } catch (e) {
      errorCarga = String((e && e.message) || e);
      if (!datos) pintar();
      return;
    }
    // Si no ha cambiado, no se repinta: así no se cierran los desplegables abiertos
    if (!datos || nuevos.generado !== datos.generado) {
      datos = nuevos;
      try {
        pintar();
      } catch (e) {
        console.error(e);
        document.getElementById("app").innerHTML = `<p class="cargando">La página no ha podido mostrar los datos (${esc(e.message)}).</p>`;
      }
    }
  }

  pintar();
  cargar();
  setInterval(cargar, CADA_MS);
  setInterval(() => {
    pintarBarra();
    if (datos && fresco(datos, Date.now()) !== firmaAlerta) pintar(); // pasa a rojo sin esperar a la siguiente carga
  }, 1000);
  let espera;
  window.addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(dibujarGraficas, 150); });
})();
