# AeroFlow — simulador interativo de escoamento ao redor de objetos

Data: 2026-10-23 · Autor do pedido: professor (FEI) · Status: rascunho para aprovação
Escopo deste documento: **v1, versão demonstrativa para máquinas leves.**

## 1. Intenção

Um dashboard web que mostra, em tempo real e de forma fisicamente convincente, o
escoamento de ar ao redor de objetos clássicos da aerodinâmica: a esteira de
vórtices de von Kármán atrás de um cilindro, aerofólios em ângulo de ataque e
outros corpos típicos.

Tem dois usos, com o mesmo peso:

1. **Em sala:** o professor projeta e muda os parâmetros ao vivo enquanto explica.
2. **Estudo autônomo:** os alunos abrem o link em casa ou no laboratório e exploram sozinhos.

A palavra-chave é **realismo**: a animação tem que sair de uma simulação física de
verdade, não de um efeito visual. Os números exibidos têm que ser honestos sobre a
própria precisão.

A v1 é **demonstrativa e leve**: o foco é o comportamento qualitativo correto, e ela
tem que rodar bem em máquinas modestas (notebook com placa de vídeo integrada).
Precisão quantitativa, comparação com dados experimentais e 3D ficam para versões
futuras (seção 10). Por isso a arquitetura não pode impedir essas evoluções.

## 2. Objetivos (v1)

- Simulação 2D de fluido em tempo real no navegador, sem instalação.
- O usuário controla **velocidade do escoamento**, **objeto**, **ângulo** e **tamanho do objeto**.
- O usuário lê **Re**, **Cd** e **Cl** em tempo real.
- Ar em regime **incompressível** (Mach ≤ 0,3, ou seja, velocidade até ~100 m/s) e em
  **escala real**: um aerofólio de corda 1 m a 30 m/s precisa funcionar (Re ~ 10⁶).
- Em Re alto, um modelo de turbulência mantém a simulação estável e plausível, e a
  tela **avisa** que Cd e Cl passam a ser aproximados.
- Qualidade ajustável ao hardware, com detecção automática e ajuste manual.
- Roda de forma fluida num notebook comum com GPU integrada.
- Publicado no **GitHub Pages**.

## 3. Não-objetivos (v1)

- Simulação 3D.
- Escoamento compressível (Mach > 0,3, ondas de choque).
- Contas de usuário, salvar sessões ou backend de qualquer tipo.
- Precisão quantitativa de CFD (tolerâncias de poucos por cento).
- Curvas de referência experimentais ou de literatura no gráfico.

## 4. Anti-objetivos (mesmo funcionando, seria um fracasso se…)

- A animação fosse "fake" (texturas animadas, vórtices desenhados), em vez de sair da simulação.
- Números aproximados aparecessem como se fossem precisos, sem o aviso.
- A simulação explodisse (NaN, tela preta ou ruído) na frente da turma sem se recuperar sozinha.

## 5. Decisões já tomadas na conversa

### 5.1 Método numérico
- **Lattice Boltzmann (LBM)**, D2Q9, rodando na GPU.
  Motivo: é local e paralelo (ideal para GPU no navegador), aceita qualquer forma de
  obstáculo por máscara de células, e as forças saem diretamente por troca de momento.
  Recupera Navier–Stokes incompressível no limite de Mach baixo.
- **Modelo de turbulência:** LES com Smagorinsky sobre um operador de colisão robusto
  (MRT ou cumulantes; a escolha fica com o construtor). É obrigatório para rodar Re ~ 10⁶ sem divergir.
- **Fronteiras do objeto:** bounce-back interpolado (Bouzidi ou similar), não a
  "escadinha" simples. Isso importa para Cl de aerofólio.

### 5.2 Escala física e Reynolds
- O usuário informa grandezas físicas: velocidade em m/s, tamanho em m (diâmetro ou corda), sempre para o **ar** (ν ≈ 1,5×10⁻⁵ m²/s).
- Re = U·L/ν é calculado a partir desses valores e exibido.
- Internamente, o mapeamento para unidades de rede ajusta a viscosidade da rede para
  reproduzir esse Re (com u_rede pequeno para manter Mach de rede baixo).
- **Indicador de fidelidade:** um aviso visível ("⚠ Re alto: modelo de turbulência, valores aproximados") aparece quando o Re
  passa do limite em que a malha atual resolve o escoamento diretamente. **O limite depende do nível de qualidade escolhido.**

### 5.3 Layout (opção A do esboço, "painel de laboratório")
- **Centro/esquerda:** a simulação, grande, com sobreposição compacta de Re · Cd · Cl.
- **Lateral direita fixa:** seletor de objeto, velocidade (m/s), ângulo (°), tamanho (m),
  campo visualizado, nível de qualidade e o aviso de fidelidade.
- **Faixa inferior:** dois gráficos sempre visíveis (conteúdo do segundo na seção 6).

### 5.4 Qualidade por hardware
- Presets **Baixa / Média / Alta**, que mudam a resolução da malha.
- Na abertura, um benchmark de 1–2 s escolhe o preset automaticamente. O usuário pode trocar.
- A interface deixa claro que a qualidade afeta a **precisão dos números**, não só a imagem.
- **WebGPU** quando disponível, **WebGL2** como reserva.
- **Máquina-alvo da v1:** notebook comum com GPU integrada. O preset **Alta** é dimensionado para ela, não para uma placa dedicada.

### 5.5 Hospedagem
- Site estático no **GitHub Pages**. Sem servidor: tudo roda no cliente.

## 6. Escolhas minhas (não discutidas a fundo; corrija se discordar)

- **Objetos:** cilindro, quadrado, placa plana, NACA 0012, NACA 2412. O ângulo vale para todos (o objeto gira).
- **Campos visualizáveis:** vorticidade (padrão, que mostra melhor a esteira), módulo de velocidade e pressão.
- **Gráficos da faixa inferior:**
  1. Cd(t) e Cl(t) ao longo do tempo;
  2. **varredura da própria simulação:** cada vez que o usuário fixa um ângulo (aerofólios) ou uma velocidade (corpos rombudos) e o valor estabiliza, um ponto é registrado em Cl × α ou Cd × Re. O aluno "monta a curva" explorando. Há um botão para limpar. Sem curvas de referência na v1, mas o gráfico já fica preparado para recebê-las no futuro.
- **Interface em português (pt-BR).**
- **Trocar velocidade ou ângulo** atualiza a simulação em andamento, sem reiniciar.
  **Trocar objeto ou tamanho** reinicia o escoamento.
- **Recuperação de divergência:** se surgir NaN ou instabilidade, a simulação reinicia sozinha e mostra uma mensagem curta, sem tela quebrada.
- **Cd e Cl** são exibidos como média móvel, com o instantâneo visível no gráfico Cd(t)/Cl(t).
- **Strouhal** aparece quando há desprendimento periódico de vórtices, calculado a partir da frequência de Cl(t). Encaixa direto com a esteira de von Kármán.
- **"Tempo real" = interativo e fluido (≥ 30 fps), não tempo físico.** A tela mostra o tempo simulado em segundos físicos e o fator de câmera lenta.
- **Arranque rápido:** ao reiniciar, uma pequena perturbação assimétrica dispara o desprendimento. Meta: esteira visível em ≤ 10 s.
- **Nota 2D:** um texto curto e fixo (ícone ⓘ) explica que a simulação é 2D e que, acima de Re ≈ 190, o escoamento real ao redor do cilindro é 3D. Detalhar isso fica para a versão com comparação experimental.
- **WebGL2 é um modo reduzido:** mesma física, presets Baixa e Média. Celular é "melhor esforço": navegador recente, de preferência com WebGPU.

## 7. Critérios de aceitação (v1, demonstrativa)

No preset Alta, numa máquina com GPU integrada:

| Caso | Esperado |
|---|---|
| Desempenho | ≥ 30 fps; esteira visível em ≤ 10 s após reiniciar |
| Cilindro, Re = 40 | escoamento estacionário, par de vórtices simétrico atrás do cilindro |
| Cilindro, Re = 100 | esteira de von Kármán alternada; Cd na faixa 1,2–1,55; St na faixa 0,14–0,19 |
| NACA 0012, α = 0° | Cl ≈ 0 (simétrico) |
| NACA 0012/2412, α pequeno crescente | Cl cresce com α; com α grande, aparecem separação e desprendimento visíveis |
| Placa plana normal ao escoamento | Cd claramente maior que o do cilindro no mesmo Re |
| Qualquer caso, Mach ≤ 0,3 | sem divergência por 10 min contínuos (ou recuperação automática, sem tela quebrada) |

## 8. Restrições

- Roda em notebooks comuns de aluno; celular no preset Baixa (melhor esforço).
- Sem dependência de servidor ou serviço externo em tempo de execução.
- Código aberto num repositório GitHub (publicado via Pages).
- Arquitetura extensível: o núcleo de simulação, a geometria dos objetos e os gráficos ficam separados, para permitir mais resolução, curvas de referência e, no futuro, um núcleo 3D.

## 9. Deixado para o construtor

- Stack de front-end e ferramenta de build (sugestão: Vite + TypeScript, sem framework pesado).
- Biblioteca de gráficos.
- Operador de colisão exato (MRT vs. cumulantes) e constante de Smagorinsky.
- Tamanho do domínio, condições de contorno de entrada, saída e laterais, e resoluções exatas de cada preset.
- Limiar exato do aviso de fidelidade por preset.
- Faixas e escalas dos controles (por exemplo, escala logarítmica de velocidade para alcançar Re 40–100 com valores reais de ar).
- Paleta de cores e acabamento visual (escuro, legível em projetor).

## 10. Futuro (fora da v1, registrado para não fechar portas)

- Preset de alta precisão para máquinas com GPU dedicada (tolerâncias de ~5 % em Cd e St).
- Curvas de referência experimentais e de simulação 2D, com aviso explícito de "efeitos 3D ausentes".
- Simulação 3D.
