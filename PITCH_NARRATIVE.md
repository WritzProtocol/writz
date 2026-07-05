# Writz Pitch Playbook & Narrative
*Master strategy to win the PULSO Hackathon and align with Stellar criteria*

---

## 1. El Pitch de 3 Minutos: La Narrativa de Writz

### **El Hook: El dilema del ahorrador latinoamericano**
> *"En América Latina, millones de personas ahorran en Bitcoin para protegerse de la inflación y la devaluación. Pero cuando surge una emergencia médica, tienen que pagar la renta o quieren emprender, se enfrentan al **dilema de Bitcoin**: o venden su BTC y pierden su reserva de valor a largo plazo (pagando altas comisiones y fricción fiscal), o quedan excluidos del crédito tradicional. 
> 
> Hoy les presentamos **Writz**: el primer protocolo de crédito Bitcoin-nativo sobre Stellar que permite obtener liquidez sin vender un solo satoshi, de forma 100% custodial en Bitcoin y 100% privada on-chain."*

### **La Innovación: Sin Custodios, Sin Puentes, Sin Exposición**
> *"El crédito DeFi tradicional sobre Bitcoin exige depositar tu dinero en puentes centralizados o en empresas custodias que pueden quebrar. Con Writz, tu Bitcoin se bloquea directamente en la red Bitcoin mediante un contrato P2WSH nativo. Nadie —ni Writz, ni Stellar— puede tocarlo. 
> 
> En la red Stellar, mediante los contratos inteligentes de Soroban que aprovechan **Protocol X-Ray (Zero-Knowledge Proofs)**, validamos criptográficamente tu posición. Writz te presta USDC nativo de Stellar sin saber tu saldo, manteniendo tu posición totalmente privada y segura frente a liquidadores oportunistas."*

### **El Impacto Real: La conexión con la última milla**
> *"No estamos creando DeFi especulativa. El USDC que Writz entrega no es un token sintético; es el USDC nativo de Circle en Stellar. A través del ecosistema de anchors de Stellar, como **MoneyGram Access**, un usuario en El Salvador o Argentina puede tomar un préstamo en Writz, ir a un agente físico de MoneyGram, y retirar efectivo en su moneda local en minutos. Eso es inclusión financiera real."*

---

## 2. Destruyendo los 4 Escenarios de Rechazo de los Jueces

Aquí está la defensa técnica y conceptual de Writz ante cada criterio que los mentores y jueces buscan evitar:

### 🔴 Red Flag 1: "Aplicaciones genéricas con integración Stellar superficial"
*   **La Defensa de Writz:** 
    *   Writz no es un fork de un protocolo de Ethereum con un logo de Stellar.
    *   La integración con Stellar es a nivel de protocolo profundo: utiliza las nuevas capacidades de **Protocol X-Ray** de Soroban para realizar la verificación on-chain de pruebas Groth16 (curva BN254) que validan el colateral de Bitcoin.
    *   El relayer del protocolo (que ya está desplegado en Railway y funcionando) procesa pruebas simplificadas de verificación SPV de Bitcoin on-chain en Soroban. Writz es una infraestructura nativa para Stellar.

### 🔴 Red Flag 2: "Primitivos DeFi especulativos sin conexión con necesidades locales"
*   **La Defensa de Writz:**
    *   Writz no ofrece apalancamiento degenerado (yield farming, leverage trading). Resuelve un problema de liquidez líquida y preservación de riqueza.
    *   Para el usuario latinoamericano promedio, Bitcoin es su cuenta de ahorros. Writz convierte esa cuenta de ahorros inactiva en una línea de crédito productiva en dólares (USDC), permitiendo pagar facturas locales sin forzar la liquidación de sus ahorros en mercados bajistas.

### 🔴 Red Flag 3: "Smart contracts que no interactúan con anchors o activos locales"
*   **La Defensa de Writz:**
    *   El activo prestado por Writz es **USDC nativo de Stellar** (nuestro contrato interactúa directamente con el Stellar Asset Contract o SAC).
    *   Writz se conecta conceptual y técnicamente con los **anchors de rampa de salida (off-ramps)** del ecosistema de Stellar. Al usar USDC estándar, cualquier billetera compatible (como L उठ o Decaf) puede canalizar el préstamo de Writz hacia MoneyGram Access para transformarlo en efectivo local físico en minutos.

### 🔴 Red Flag 4: "Proyectos que ignoran el mercado local y a usuarios reales"
*   **La Defensa de Writz:**
    *   Presentamos el caso de uso de **Mateo** (ver sección 3), un micro-emprendedor en El Salvador.
    *   El desarrollo y la UX están adaptados a la realidad local: comisiones de centavos de dólar gracias a Stellar y tiempos de confirmación instantáneos, haciendo que un préstamo de $50 USD sea económicamente viable (lo cual es imposible en Ethereum debido al costo de gas de los contratos ZK).

---

## 3. Caso de Estudio Local: El Caso de Mateo (El Salvador)

Para ganar el hackathon, debes personificar el problema. Usa este caso de estudio en tu presentación:

*   **Quién:** Mateo, 29 años, programador independiente y micro-importador de hardware en San Salvador.
*   **El Problema:** El 70% de los ingresos de Mateo se ahorran en Bitcoin debido a la inflación de la economía local. Recibe una oportunidad para importar un lote de laptops con un descuento del 40%, pero el proveedor exige un pago inmediato de **$1,500 USDC**. Mateo no quiere vender su Bitcoin porque considera que está a un precio infravalorado y perdería su apreciación futura.
*   **Cómo ayuda Writz:**
    1.  Mateo abre Writz y genera una dirección de depósito Bitcoin P2WSH.
    2.  Deposita el equivalente a **$2,500 USD** en BTC en la red de Bitcoin (totalmente bajo su custodia scriptada).
    3.  El relayer de Writz detecta la transacción y envía la prueba SPV a Soroban.
    4.  El contrato inteligente de Soroban verifica la transacción y emite **$1,500 USDC** directamente a la billetera Stellar de Mateo.
    5.  Mateo paga a su proveedor usando USDC de Stellar de forma instantánea.
    6.  Tres meses después, Mateo vende las laptops, obtiene su ganancia, devuelve los $1,500 USDC al contrato de Writz, y recupera su Bitcoin intacto.

---

## 4. Diferenciación Competitiva: Lo que Writz ya tiene Funcionando
Los jueces odian las "diapositivas bonitas sin código". Writz destaca porque tiene un stack real y funcional:

1.  **4 Contratos Inteligentes en Rust** listos en Soroban testnet (`bitcoin-spv`, `zk-verifier`, `commitment-tree`, `private-lend`).
2.  **Relayer SPV en TypeScript** desplegado en vivo en Railway que sincroniza las pruebas de Bitcoin de forma automatizada.
3.  **268 Pruebas Unitarias e Integración** que validan el flujo criptográfico de inicio a fin.
4.  **No custodia real:** El código de Bitcoin Script desarrollado permite al usuario recuperar su BTC de forma unilateral mediante un timelock si Writz dejara de funcionar, eliminando el riesgo de contraparte de puentes tradicionales.
