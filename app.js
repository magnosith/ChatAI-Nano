const $ = (selector) => document.querySelector(selector)

const els = {
    status: $('#status'),
    statusText: $('#status-text'),
    progress: $('#progress'),
    progressBar: $('#progress-bar'),
    temperature: $('#temperature'),
    temperatureValue: $('#temperature-value'),
    topK: $('#top-k'),
    samplingNote: $('#sampling-note'),
    systemPrompt: $('#system-prompt'),
    usage: $('#usage'),
    usageBar: $('#usage-bar'),
    reset: $('#reset'),
    messages: $('#messages'),
    empty: $('#empty'),
    form: $('#composer'),
    question: $('#question'),
    send: $('#send'),
    stop: $('#stop'),
    attach: $('#attach'),
    file: $('#file'),
    attachments: $('#attachments'),
}

// Idiomas suportados pelo modelo: de, en, es, fr, ja (pt ainda não está na lista)
const TEXT_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

// Imagem e áudio (em inglês) precisam ser declarados na criação da sessão
const MULTIMODAL_OPTIONS = {
    expectedInputs: [
        { type: 'text', languages: ['en'] },
        { type: 'image' },
        { type: 'audio', languages: ['en'] },
    ],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

const state = {
    session: null,
    sessionKey: '',
    samplingEnabled: false,
    multimodal: false,
    attachment: null,
    controller: null,
    busy: false,
}

init()

async function init() {
    bindEvents()
    updateTemperatureLabel()

    if (!('LanguageModel' in self)) {
        setStatus('error', 'Prompt API não encontrada neste navegador')
        setControlsEnabled(false)
        return
    }

    const availability = await LanguageModel.availability(TEXT_OPTIONS)
    console.log('Language Model Availability:', availability)

    const multimodalAvailability = await LanguageModel.availability(MULTIMODAL_OPTIONS).catch(() => 'unavailable')
    state.multimodal = multimodalAvailability !== 'unavailable'
    els.attach.disabled = !state.multimodal
    if (!state.multimodal) els.attach.title = 'Imagem e áudio não estão disponíveis neste navegador'

    await setupSampling()
    showAvailability(availability)
}

// params() só existe em extensões nas versões mais novas do Chrome (no 140 ainda funcionava em páginas).
// Carregando esta pasta como extensão (manifest.json), os controles ficam ativos.
async function setupSampling() {
    if (typeof LanguageModel.params !== 'function') {
        els.temperature.disabled = true
        els.topK.disabled = true
        els.topK.value = ''
        els.topK.placeholder = 'padrão'
        document.querySelectorAll('.stepper button').forEach((button) => (button.disabled = true))
        els.temperatureValue.textContent = 'padrão'
        els.samplingNote.hidden = false
        return
    }

    const params = await LanguageModel.params()
    console.log('Language Model Params:', params)

    state.samplingEnabled = true
    els.temperature.max = params.maxTemperature
    els.temperature.value = params.defaultTemperature
    els.topK.max = params.maxTopK
    els.topK.value = params.defaultTopK
    updateTemperatureLabel()
}

function showAvailability(availability) {
    const messages = {
        available: ['ready', 'Modelo pronto'],
        downloadable: ['download', 'O modelo será baixado na primeira mensagem'],
        downloading: ['download', 'Baixando o modelo…'],
        unavailable: ['error', 'Modelo indisponível neste dispositivo'],
    }
    const [kind, text] = messages[availability] ?? ['error', `Estado desconhecido: ${availability}`]
    setStatus(kind, text)
    if (availability === 'unavailable') setControlsEnabled(false)
}

function setStatus(kind, text) {
    els.status.dataset.state = kind
    els.statusText.textContent = text
}

function setControlsEnabled(enabled) {
    els.question.disabled = !enabled
    els.send.disabled = !enabled
    els.attach.disabled = !enabled || !state.multimodal
    document.querySelectorAll('.suggestion').forEach((button) => (button.disabled = !enabled))
}

function bindEvents() {
    els.temperature.addEventListener('input', updateTemperatureLabel)

    document.querySelectorAll('.stepper button').forEach((button) => {
        button.addEventListener('click', () => {
            const next = Number(els.topK.value || 1) + Number(button.dataset.step)
            els.topK.value = clamp(next, Number(els.topK.min), Number(els.topK.max))
        })
    })

    els.question.addEventListener('input', autoResize)
    els.question.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            els.form.requestSubmit()
        }
    })

    els.form.addEventListener('submit', (event) => {
        event.preventDefault()
        ask()
    })

    document.querySelectorAll('.suggestion').forEach((button) => {
        button.addEventListener('click', () => {
            els.question.value = button.textContent
            ask()
        })
    })

    els.stop.addEventListener('click', () => state.controller?.abort())
    els.reset.addEventListener('click', resetConversation)

    els.attach.addEventListener('click', () => els.file.click())
    els.file.addEventListener('change', () => {
        const [file] = els.file.files
        if (file) setAttachment(file)
        els.file.value = ''
    })
}

function updateTemperatureLabel() {
    const { value, min, max } = els.temperature
    const fill = ((value - min) / (max - min)) * 100
    els.temperature.style.setProperty('--fill', `${fill}%`)
    if (!els.temperature.disabled) els.temperatureValue.textContent = Number(value).toFixed(1)
}

function autoResize() {
    els.question.style.height = 'auto'
    els.question.style.height = `${els.question.scrollHeight}px`
}

// ---------- Anexos ----------

function setAttachment(file) {
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : null
    if (!type) return

    clearAttachment()
    state.attachment = { type, file, url: URL.createObjectURL(file) }

    const preview = type === 'image'
        ? `<img src="${state.attachment.url}" alt="">`
        : '<span class="file-icon">🎧</span>'

    els.attachments.innerHTML = `
        <div class="attachment">
            ${preview}
            <span class="attachment-name"></span>
            <button type="button" aria-label="Remover anexo">✕</button>
        </div>`
    els.attachments.querySelector('.attachment-name').textContent = file.name
    els.attachments.querySelector('button').addEventListener('click', clearAttachment)
    els.attachments.hidden = false
}

function clearAttachment(revoke = true) {
    if (revoke && state.attachment) URL.revokeObjectURL(state.attachment.url)
    state.attachment = null
    els.attachments.innerHTML = ''
    els.attachments.hidden = true
}

// ---------- Sessão ----------

function readSettings() {
    return {
        temperature: Number(els.temperature.value),
        topK: Number(els.topK.value),
        systemPrompt: els.systemPrompt.value.trim(),
    }
}

// A sessão guarda o histórico da conversa; se os ajustes mudarem, ela precisa ser recriada
function discardSessionIfSettingsChanged() {
    if (!state.session || JSON.stringify(readSettings()) === state.sessionKey) return

    state.session.destroy()
    state.session = null
    addDivider('Ajustes alterados · nova sessão iniciada')
}

async function getSession() {
    if (state.session) return state.session

    const settings = readSettings()
    const options = {
        ...(state.multimodal ? MULTIMODAL_OPTIONS : TEXT_OPTIONS),
        initialPrompts: [{ role: 'system', content: settings.systemPrompt }],
        monitor(m) {
            m.addEventListener('downloadprogress', (event) => {
                const percent = Math.round(event.loaded * 100)
                setStatus('download', `Baixando o modelo… ${percent}%`)
                els.progress.hidden = false
                els.progressBar.style.width = `${percent}%`
            })
        },
    }

    if (state.samplingEnabled) {
        options.temperature = settings.temperature
        options.topK = settings.topK
    }

    state.session = await LanguageModel.create(options)
    state.sessionKey = JSON.stringify(settings)
    els.progress.hidden = true
    setStatus('ready', 'Modelo pronto')
    updateUsage()
    return state.session
}

function resetConversation() {
    state.controller?.abort()
    state.session?.destroy()
    state.session = null
    state.sessionKey = ''
    els.messages.querySelectorAll('.message, .divider').forEach((node) => node.remove())
    els.empty.hidden = false
    updateUsage()
}

function updateUsage() {
    const session = state.session
    if (!session) {
        els.usage.textContent = 'Nenhuma sessão aberta'
        els.usageBar.style.width = '0'
        return
    }

    // Nomes novos (inputUsage/inputQuota) e antigos (tokensSoFar/maxTokens) da API
    const used = session.inputUsage ?? session.tokensSoFar ?? 0
    const quota = session.inputQuota ?? session.maxTokens
    if (!quota) {
        els.usage.textContent = `${used} tokens usados`
        return
    }
    els.usage.textContent = `${used.toLocaleString('pt-BR')} de ${quota.toLocaleString('pt-BR')} tokens`
    els.usageBar.style.width = `${Math.min(100, (used / quota) * 100)}%`
}

// ---------- Conversa ----------

async function ask() {
    if (state.busy) return

    const question = els.question.value.trim()
    const attachment = state.attachment
    if (!question && !attachment) return

    els.question.value = ''
    autoResize()
    clearAttachment(false)
    discardSessionIfSettingsChanged()
    addUserMessage(question, attachment)

    const content = [{ type: 'text', value: question || 'Descreva este arquivo.' }]
    if (attachment) content.push({ type: attachment.type, value: attachment.file })

    const bubble = addAssistantMessage()
    setBusy(true)
    state.controller = new AbortController()
    const startedAt = performance.now()

    try {
        const session = await getSession()
        const responseStream = session.promptStreaming(
            [{ role: 'user', content }],
            { signal: state.controller.signal },
        )

        let fullText = ''
        for await (const token of responseStream) {
            fullText += token
            bubble.innerHTML = markdown.toHTML(fullText)
            scrollToBottom()
        }

        addMeta(bubble, `${((performance.now() - startedAt) / 1000).toFixed(1)}s`)
    } catch (error) {
        if (error.name === 'AbortError') {
            addMeta(bubble, 'Resposta interrompida')
        } else {
            console.error(error)
            bubble.classList.add('error')
            bubble.textContent = `Erro: ${error.message}`
            if (!state.session) setStatus('error', 'Não foi possível iniciar o modelo')
        }
    } finally {
        state.controller = null
        setBusy(false)
        updateUsage()
        els.question.focus()
    }
}

function setBusy(busy) {
    state.busy = busy
    els.send.hidden = busy
    els.stop.hidden = !busy
    document.querySelectorAll('.suggestion').forEach((button) => (button.disabled = busy))
}

function addUserMessage(text, attachment) {
    const bubble = createMessage('user', 'EU')
    if (attachment?.type === 'image') {
        const img = document.createElement('img')
        img.src = attachment.url
        img.alt = attachment.file.name
        bubble.append(img)
    } else if (attachment?.type === 'audio') {
        const audio = document.createElement('audio')
        audio.src = attachment.url
        audio.controls = true
        bubble.append(audio)
    }
    if (text) bubble.append(document.createTextNode(text))
}

function addAssistantMessage() {
    const bubble = createMessage('assistant', 'IA')
    bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>'
    return bubble
}

function createMessage(role, avatar) {
    els.empty.hidden = true

    const message = document.createElement('div')
    message.className = `message ${role}`
    message.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble"></div>`
    els.messages.append(message)
    scrollToBottom()
    return message.querySelector('.bubble')
}

function addMeta(bubble, text) {
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = text
    bubble.append(meta)
}

function addDivider(text) {
    const divider = document.createElement('div')
    divider.className = 'divider'
    divider.textContent = text
    els.messages.append(divider)
}

function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}
