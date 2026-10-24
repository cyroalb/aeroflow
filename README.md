# AeroFlow

AeroFlow é um laboratório virtual de aerodinâmica para estudantes e professores. Ele roda no navegador uma
simulação real, em tempo real, do escoamento de ar ao redor de um objeto (cilindro, quadrado, placa ou perfis
NACA). Você ajusta a velocidade, o tamanho e o ângulo de ataque e vê o campo de vorticidade, velocidade ou
pressão se formar. Ao mesmo tempo aparecem o número de Reynolds e os coeficientes de arrasto (Cd) e de
sustentação (Cl). Para corpos rombudos aparece também o número de Strouhal (St) da esteira de von Kármán.
Cada pixel vem da simulação; não há animação decorativa.

O site é totalmente estático. Ele usa WebGPU quando o navegador oferece e WebGL2 (com texturas float) como
alternativa. Funciona em versões recentes do Chrome, Edge e Firefox.

## Como rodar localmente

Requer Node.js 22 ou mais recente.

```bash
npm install
npm run dev          # servidor de desenvolvimento (Vite)
```

Para gerar e servir a versão de produção (pasta `dist/`, caminhos relativos):

```bash
npm run build
npx vite preview
```

Para forçar uma resolução, acrescente `?preset=baixa`, `?preset=media` ou `?preset=alta` ao endereço.
A resolução Alta exige WebGPU.

## Testes

| Comando | O que faz | Duração aproximada |
|---|---|---|
| `npm test` | testes unitários (Vitest) | segundos |
| `npm run test:physics` | validação física do solver de referência em CPU (cilindro, placa, perfis) | ~36 min |
| `npx playwright test` ou `npm run e2e` | testes ponta a ponta no Chromium (WebGPU e fallback WebGL2) | poucos minutos |
| `npm run e2e:acceptance` | aceitação da especificação §7 na resolução Alta (Cd, St, esteira, fps, Re = 40, NACA 0012) | ~4 min |
| `npm run e2e:soak` | estabilidade por 10 minutos (teste `@soak`) | ~11 min |

Os testes de aceitação só verificam fps ≥ 30 em máquinas com GPU de verdade. Para isso, defina
`GPU_RUNNER=1`:

```bash
GPU_RUNNER=1 npm run e2e:acceptance                     # bash
$env:GPU_RUNNER='1'; npm run e2e:acceptance             # PowerShell
```

Sem essa variável, a verificação de fps é pulada e o motivo fica registrado nas anotações do teste.
Antes dos testes ponta a ponta, encerre qualquer `vite preview` antigo na porta 4173.

## Método físico

A simulação usa o método de Lattice Boltzmann (LBM) em duas dimensões com a rede D2Q9. A colisão é BGK
regularizada, com um modelo de turbulência de Smagorinsky (LES, Cs = 0,1) que soma uma viscosidade turbulenta
local quando a malha não resolve todas as escalas. A superfície do objeto usa o *bounce-back* interpolado de
Bouzidi, que leva em conta a posição exata da parede entre os nós da malha. A entrada impõe velocidade
uniforme, a saída impõe pressão fixa, e as paredes de cima e de baixo são deslizantes. As forças no objeto
vêm do método de troca de quantidade de movimento (*momentum exchange*) e dão Cd e Cl. O número de Strouhal
vem do período de oscilação de Cl. As grandezas físicas (ar, ν = 1,5×10⁻⁵ m²/s) são convertidas para unidades
da rede mantendo o número de Reynolds.

## Aviso de fidelidade

Quando aparece `⚠ Re alto: modelo de turbulência, valores aproximados`, o número de Reynolds é alto demais
para a malha resolver todos os detalhes do escoamento (Re dividido pelo tamanho do objeto em células passa de
10). O modelo de turbulência mantém a simulação estável e o comportamento qualitativo é coerente, mas os
valores de Cd, Cl e St devem ser tratados como aproximados.

## Limitação 2D

Esta simulação é 2D. Acima de Re ≈ 190, o escoamento real ao redor de um cilindro é tridimensional; os
valores aqui não capturam esses efeitos. Em números de Reynolds altos, compare tendências, não valores exatos.

## Publicação

O fluxo `.github/workflows/pages.yml` publica o site no GitHub Pages a cada *push* na branch `main`. Ele roda
`npm ci`, `npm test` e `npm run build`, e então publica a pasta `dist/`.
