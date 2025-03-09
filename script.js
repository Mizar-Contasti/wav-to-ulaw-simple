// script.js (Complete, with corrected formatDuration and all features)

// DOM Element References
const fileInput = document.getElementById('wavFileInput');
const fileInfoDiv = document.getElementById('fileInfo');
const bitRateSpan = document.getElementById('bitRate');
const channelsSpan = document.getElementById('channels');
const sampleRateSpan = document.getElementById('sampleRate');
const sampleSizeSpan = document.getElementById('sampleSize');
const durationSpan = document.getElementById('duration');
const fileSizeSpan = document.getElementById('fileSize');
const runButton = document.getElementById('runButton');
const downloadLink = document.getElementById('downloadLink');
const messageDiv = document.getElementById('message');
const progressElement = document.getElementById('progress');
const fileNameSpan = document.getElementById('fileName');
const currentYearSpan = document.getElementById('currentYear');

let audioData = null; // Store the raw audio data globally
let originalFileName = "";

// UIkit Initialization
UIkit.use(UIkitIcons);

// --- Utility Functions ---

const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
};

const validateWavFile = async (file) => {
    if (!file) {
        throw new Error('No file selected.');
    }
    if (file.type !== 'audio/wav' && file.type !== 'audio/x-wav') {
        throw new Error('Invalid file type. Please select a .wav file.');
    }
    const audioData = await readFileAsArrayBuffer(file);
    const fileData = new DataView(audioData);

    const riffChunkId = String.fromCharCode(...new Uint8Array(audioData, 0, 4));
    if (riffChunkId !== 'RIFF') { throw new Error('Not a valid RIFF file.'); }

    const waveChunkId = String.fromCharCode(...new Uint8Array(audioData, 8, 4));
    if (waveChunkId !== 'WAVE') { throw new Error('Not a valid WAVE file.'); }

    const fmtChunkId = String.fromCharCode(...new Uint8Array(audioData, 12, 4));
    if (fmtChunkId !== 'fmt ') { throw new Error('fmt chunk not found.'); }

    const fmtChunkSize = fileData.getUint32(16, true);
    if (fmtChunkSize !== 16) { throw new Error('Invalid fmt chunk size. Only PCM/uncompressed WAV is supported.'); }

    const audioFormat = fileData.getUint16(20, true);
    if (audioFormat !== 1) { throw new Error('Only PCM audio format is supported.'); }

    const numChannels = fileData.getUint16(22, true);
    if (numChannels !== 1 && numChannels !== 2) { throw new Error('Only mono or stereo WAV files are supported.'); }

    const sampleRate = fileData.getUint32(24, true);
    if (sampleRate % 8000 !== 0) { throw new Error("Sample rate must be a multiple of 8000 Hz.");}

    const bitsPerSample = fileData.getUint16(34, true);
    if (bitsPerSample !== 16) { throw new Error('Only 16-bit audio is supported.'); }

    let dataChunkOffset = 12 + 8 + fmtChunkSize;
    let dataChunkId;
    do {
        dataChunkId = String.fromCharCode(...new Uint8Array(audioData, dataChunkOffset, 4));
        if (dataChunkId !== 'data') {
            const chunkSize = fileData.getUint32(dataChunkOffset + 4, true);
            dataChunkOffset += 8 + chunkSize;
            if (dataChunkOffset >= fileData.byteLength) {
                throw new Error("Data chunk not found.");
            }
        }
    } while (dataChunkId !== 'data');
};

const pcm16ToMuLaw = (pcm16) => {
    const MU = 255;
    const BIAS = 132;
    let sign = 0;
    if (pcm16 < 0) {
        pcm16 = -pcm16;
        sign = 0x80;
    }
    pcm16 = pcm16 + BIAS;
    if (pcm16 > 32767) {
        pcm16 = 32767;
    }
    let muLaw = Math.floor(Math.log(1 + (MU * pcm16) / 32767) / Math.log(1 + MU) * 128);
    return muLaw ^ sign ^ 0x7F;
};

const encodeWavToMuLaw = async (audioData, updateProgress) => {
    const fileData = new DataView(audioData);
    const riffChunkId = String.fromCharCode(...new Uint8Array(audioData, 0, 4));
    const waveChunkId = String.fromCharCode(...new Uint8Array(audioData, 8, 4));
    const fmtChunkId = String.fromCharCode(...new Uint8Array(audioData, 12, 4));
    const fmtChunkSize = fileData.getUint32(16, true);
    const audioFormat = fileData.getUint16(20, true);
    const numChannels = fileData.getUint16(22, true);
    const sampleRate = fileData.getUint32(24, true);
    const bitsPerSample = fileData.getUint16(34, true);
    if (bitsPerSample !== 16) { throw new Error('Only 16-bit audio is supported.'); }
    if (sampleRate % 8000 !== 0) { throw new Error("Sample rate must be a multiple of 8000 Hz."); }

    let dataChunkOffset = 12 + 8 + fmtChunkSize;
    let dataChunkId;
    do {
        dataChunkId = String.fromCharCode(...new Uint8Array(audioData, dataChunkOffset, 4));
        if (dataChunkId !== 'data') {
            const chunkSize = fileData.getUint32(dataChunkOffset + 4, true);
            dataChunkOffset += 8 + chunkSize;
            if (dataChunkOffset >= fileData.byteLength) {  throw new Error("Data chunk not found."); }
        }
    } while (dataChunkId !== 'data');

    const dataChunkSize = fileData.getUint32(dataChunkOffset + 4, true);
    const dataStart = dataChunkOffset + 8;
    const bytesPerSample = bitsPerSample / 8;

    const downsampleFactor = sampleRate / 8000;
    const outputBufferSize = Math.floor(dataChunkSize / (numChannels * bytesPerSample) / downsampleFactor);
    const outputBuffer = new Uint8Array(outputBufferSize);
    let outputIndex = 0;
    const windowSize = 5;
    const sampleBuffer = [];

    for (let i = dataStart; i < dataStart + dataChunkSize; i += bytesPerSample * numChannels) {
        let sum = 0;
        for (let channel = 0; channel < numChannels; channel++) {
            const sampleIndex = i + channel * bytesPerSample;
            if (sampleIndex < dataStart + dataChunkSize) {
                sum += fileData.getInt16(sampleIndex, true);
            }
        }
        let monoSample = Math.round(sum / numChannels);

        sampleBuffer.push(monoSample);
        if (sampleBuffer.length > windowSize) {
            sampleBuffer.shift();
        }

        if ((i - dataStart) % (bytesPerSample * numChannels * downsampleFactor) === 0) {
            let smoothedSample = 0;
            if (sampleBuffer.length > 0) {
                smoothedSample = Math.round(sampleBuffer.reduce((a, b) => a + b, 0) / sampleBuffer.length);
            }
            const muLawSample = pcm16ToMuLaw(smoothedSample);
            outputBuffer[outputIndex++] = muLawSample;
            const currentProgress = Math.round((outputIndex / outputBufferSize) * 100);
            if (updateProgress) {
                updateProgress(currentProgress);
            }
        }
    }
    return outputBuffer;
};

const createWavHeader = (dataLength) => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLength, true); // Chunk size
    view.setUint32(8, 0x57415645, false); // "WAVE"

    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 7, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);

    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true);

    return buffer;
};

const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (num) => String(num).padStart(2, '0');

    // Build the string *inside* the function using template literals
    if (h > 0) {
        return `${h}:${pad(m)}:${pad(s)}`; // Return the formatted string
    } else {
        return `${m}:${pad(s)}`; // Return the formatted string
    }
};

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// --- Audio Player Variables ---
let audioElement = null;
let isPlaying = false;
let playPauseButton = null; // Store the button globally

// --- Event Listeners and Main Logic ---

fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    // Reset player and other UI elements
    resetAudioPlayer();
    progressElement.value = 0;
    downloadLink.style.display = 'none';

    originalFileName = file.name.replace(/\.wav$/i, "");
    fileNameSpan.textContent = file.name;

    try {
        await validateWavFile(file);
        audioData = await readFileAsArrayBuffer(file);
        const fileData = new DataView(audioData);

        const numChannels = fileData.getUint16(22, true);
        const sampleRate = fileData.getUint32(24, true);
        const bitsPerSample = fileData.getUint16(34, true);
        const byteRate = fileData.getUint32(28, true);

        let dataChunkOffset = 12 + 8 + fileData.getUint32(16, true);
        let dataChunkId;
        do {
            dataChunkId = String.fromCharCode(...new Uint8Array(audioData, dataChunkOffset, 4));
            if (dataChunkId !== 'data') {
                const chunkSize = fileData.getUint32(dataChunkOffset + 4, true);
                dataChunkOffset += 8 + chunkSize;
                if (dataChunkOffset >= fileData.byteLength) {
                    throw new Error("Data chunk not found.");
                }
            }
        } while (dataChunkId !== 'data');
        const dataChunkSize = fileData.getUint32(dataChunkOffset + 4, true);
        const durationInSeconds = dataChunkSize / byteRate;

        bitRateSpan.textContent = `${byteRate * 8} bps`;
        channelsSpan.textContent = numChannels;
        sampleRateSpan.textContent = `${sampleRate} Hz`;
        sampleSizeSpan.textContent = `${bitsPerSample} bit`;
        durationSpan.textContent = formatDuration(durationInSeconds); // Call formatDuration *here*
        fileSizeSpan.textContent = formatFileSize(file.size);
        fileInfoDiv.style.display = 'block';
        runButton.style.display = 'inline-block';
        messageDiv.textContent = '';

    } catch (error) {
        console.error('Error reading WAV file:', error);
        showErrorModal(error.message);
        fileInfoDiv.style.display = 'none';
        runButton.style.display = 'none';
    }
});

runButton.addEventListener('click', async () => {
    messageDiv.textContent = 'Processing...';
    runButton.disabled = true;
    downloadLink.style.display = 'none';
    progressElement.value = 0;

    try {
        const encodedData = await encodeWavToMuLaw(audioData, (progress) => {
            progressElement.value = progress;
        });

        const header = createWavHeader(encodedData.length);
        const combined = new Uint8Array(header.byteLength + encodedData.length);
        combined.set(new Uint8Array(header), 0);
        combined.set(encodedData, header.byteLength);

        const blob = new Blob([combined], { type: 'audio/wav' }); // Keep type as audio/wav
        const url = URL.createObjectURL(blob);

        downloadLink.href = url;
        downloadLink.download = `${originalFileName}.ulaw`; // Change the extension here!
        downloadLink.style.display = 'inline-block';
        messageDiv.textContent = 'Conversion complete!';
        createAudioPlayer(blob);

    } catch (error) {
        console.error('Error during conversion:', error);
        showErrorModal(error.message);
        messageDiv.textContent = `Error: ${error.message}`;
        progressElement.value = 0;
    } finally {
        runButton.disabled = false;
    }
});

// --- UIkit Modal ---
const showErrorModal = (message) => {
    const modal = document.createElement('div');
    modal.className = 'uk-modal';
    modal.style.display = 'block';

    modal.innerHTML = `
        <div class="uk-modal-dialog uk-modal-body">
            <h2 class="uk-modal-title">Error</h2>
            <p>${message}</p>
            <button class="uk-button uk-button-default uk-modal-close" type="button">Close</button>
        </div>
    `;

    document.body.appendChild(modal);
    UIkit.modal(modal).show();

    modal.querySelector('.uk-modal-close').addEventListener('click', () => {
        UIkit.modal(modal).hide();
        modal.remove();
    });
};

// --- Audio Player ---

const createAudioPlayer = (audioBlob) => {
    resetAudioPlayer(); // Clear any existing player

    audioElement = document.createElement('audio');
    audioElement.src = URL.createObjectURL(audioBlob);
    audioElement.preload = 'none';

    if (!playPauseButton) {
        playPauseButton = document.createElement('button');
        playPauseButton.className = 'uk-button uk-button-primary uk-margin-small-left'; // Initial style
        setPlayPauseButtonText(playPauseButton);

        playPauseButton.addEventListener('click', () => {
            if (isPlaying) {
                audioElement.pause();
            } else {
                audioElement.play().catch(error => {
                    console.error("Playback failed:", error);
                    showErrorModal("Playback failed.  See console for details.");
                });
            }
        });
    }

    audioElement.addEventListener('ended', () => {
        isPlaying = false;
        setPlayPauseButtonText(playPauseButton);
    });
    audioElement.addEventListener('play', () => {
        isPlaying = true;
        setPlayPauseButtonText(playPauseButton);
    });
    audioElement.addEventListener('pause', () => {
        isPlaying = false;
        setPlayPauseButtonText(playPauseButton);
    });

    downloadLink.parentNode.insertBefore(playPauseButton, downloadLink.nextSibling);
};

const setPlayPauseButtonText = (button) => {
    button.textContent = isPlaying ? 'Pause' : 'Play μ-law';
    button.classList.remove(isPlaying ? 'uk-button-primary' : 'uk-button-danger');
    button.classList.add(isPlaying ? 'uk-button-danger' : 'uk-button-primary');
};

const resetAudioPlayer = () => {
    if (audioElement) {
        audioElement.pause();
        audioElement = null;
        isPlaying = false;
    }
    if (playPauseButton && playPauseButton.parentNode) {
        playPauseButton.parentNode.removeChild(playPauseButton);
    }
};

// Set the current year in the footer
currentYearSpan.textContent = new Date().getFullYear();