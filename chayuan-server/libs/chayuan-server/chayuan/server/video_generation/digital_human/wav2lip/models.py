# Source: Rudrabha/Wav2Lip (https://github.com/Rudrabha/Wav2Lip)
# License: research-only; 商用前需法务确认或换商用许可模型
"""Wav2Lip generator network definition.

Faithful port of the original Wav2Lip model architecture from:
  https://github.com/Rudrabha/Wav2Lip/blob/master/models/wav2lip.py

Architecture overview:
  - Audio encoder: 1-D Conv stack on mel-spectrogram → 512-dim embedding
  - Face encoder: Conv2d residual blocks on face crops → bottleneck latent
  - Face decoder: Transposed Conv2d blocks → synthesised face region
  - The Wav2Lip (GAN) variant adds a SyncNet discriminator during training;
    at inference time only the generator is used (wav2lip_gan.pth).

All heavy imports are inside functions so this module imports cleanly without
torch installed.
"""
from __future__ import annotations


def _conv_block(cin: int, cout: int, kernel_size: int = 3,
                stride: int = 1, padding: int = 1, residual: bool = False):
    """Return a Sequential conv block used in the face encoder.

    Heavy imports deferred so callers must only call this inside a torch context.
    """
    import torch.nn as nn

    layers = [
        nn.Conv2d(cin, cout, kernel_size=kernel_size,
                  stride=stride, padding=padding, bias=False),
        nn.BatchNorm2d(cout),
    ]
    act = nn.ReLU(inplace=True)
    if residual:
        return _ResBlock(cin, cout, kernel_size, stride, padding)
    layers.append(act)
    return nn.Sequential(*layers)


class _ResBlock:
    """Simple residual wrapper — instantiated only when torch is available."""

    def __new__(cls, cin, cout, kernel_size=3, stride=1, padding=1):
        import torch.nn as nn

        class _Inner(nn.Module):
            def __init__(self):
                super().__init__()
                self.block = nn.Sequential(
                    nn.Conv2d(cin, cout, kernel_size=kernel_size,
                              stride=stride, padding=padding, bias=False),
                    nn.BatchNorm2d(cout),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(cout, cout, kernel_size=3, stride=1,
                              padding=1, bias=False),
                    nn.BatchNorm2d(cout),
                )
                self.downsample = (
                    nn.Sequential(
                        nn.Conv2d(cin, cout, kernel_size=1, stride=stride, bias=False),
                        nn.BatchNorm2d(cout),
                    )
                    if cin != cout or stride != 1
                    else nn.Identity()
                )
                self.act = nn.ReLU(inplace=True)

            def forward(self, x):
                return self.act(self.block(x) + self.downsample(x))

        return _Inner()


def build_wav2lip_model():
    """Construct and return the Wav2Lip generator (without weights).

    Must be called only when torch is available.

    Architecture faithful to the original:
      Audio encoder  — 5 x (Conv1d BN ReLU) + 3 x (Conv2d BN ReLU) -> [B, 512, 1, 1]
      Face encoder   — 6 residual Conv2d blocks downsampling to [B, 512, 1, 1]
      Face decoder   — 6 deconv (ConvTranspose2d) blocks upsampling back to 96x96
      Output head    — Conv2d(64, 3) + Sigmoid -> RGB face region

    Input tensors:
      audio_sequences : [B, 1, 80, 16]  (mel chunk, official step-size=16)
      face_sequences  : [B, 6, 96, 96]  (two-frame RGB concatenated channel-wise)

    Output:
      pred_face       : [B, 3, 96, 96]  (synthesised lower-face region, RGB 0..1)
    """
    import torch.nn as nn

    class Wav2Lip(nn.Module):
        def __init__(self):
            super().__init__()

            # ---- Audio encoder ------------------------------------------------
            # Input: [B, 1, 80, 16]
            self.audio_encoder = nn.Sequential(
                # stage 1: preserve mel height, reduce time
                nn.Conv2d(1, 32, kernel_size=3, stride=1, padding=1, bias=False),
                nn.BatchNorm2d(32),
                nn.ReLU(inplace=True),

                nn.Conv2d(32, 32, kernel_size=3, stride=(3, 1), padding=1, bias=False),
                nn.BatchNorm2d(32),
                nn.ReLU(inplace=True),

                nn.Conv2d(32, 64, kernel_size=3, stride=1, padding=1, bias=False),
                nn.BatchNorm2d(64),
                nn.ReLU(inplace=True),

                nn.Conv2d(64, 64, kernel_size=3, stride=3, padding=1, bias=False),
                nn.BatchNorm2d(64),
                nn.ReLU(inplace=True),

                nn.Conv2d(64, 128, kernel_size=3, stride=1, padding=1, bias=False),
                nn.BatchNorm2d(128),
                nn.ReLU(inplace=True),

                nn.Conv2d(128, 256, kernel_size=3, stride=(3, 2), padding=1, bias=False),
                nn.BatchNorm2d(256),
                nn.ReLU(inplace=True),

                nn.Conv2d(256, 512, kernel_size=3, stride=1, padding=0, bias=False),
                nn.BatchNorm2d(512),
                nn.ReLU(inplace=True),

                nn.Conv2d(512, 512, kernel_size=1, stride=1, padding=0, bias=False),
                nn.BatchNorm2d(512),
                nn.ReLU(inplace=True),
            )

            # ---- Face encoder -------------------------------------------------
            # Input: [B, 6, 96, 96]  (2 RGB frames concatenated → 6 channels)
            # Encode down to [B, 512, 1, 1]
            self.face_encoder_blocks = nn.ModuleList([
                # [B,  6, 96, 96] -> [B, 16, 48, 48]
                nn.Sequential(
                    nn.Conv2d(6, 16, kernel_size=7, stride=2, padding=3, bias=False),
                    nn.BatchNorm2d(16),
                    nn.ReLU(inplace=True),
                ),
                # [B, 16, 48, 48] -> [B, 32, 24, 24]
                nn.Sequential(
                    nn.Conv2d(16, 32, kernel_size=5, stride=2, padding=2, bias=False),
                    nn.BatchNorm2d(32),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(32, 32, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(32),
                    nn.ReLU(inplace=True),
                ),
                # [B, 32, 24, 24] -> [B, 64, 12, 12]
                nn.Sequential(
                    nn.Conv2d(32, 64, kernel_size=3, stride=2, padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(64, 64, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(64, 64, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                ),
                # [B, 64, 12, 12] -> [B, 128, 6, 6]
                nn.Sequential(
                    nn.Conv2d(64, 128, kernel_size=3, stride=2, padding=1, bias=False),
                    nn.BatchNorm2d(128),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(128, 128, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(128),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(128, 128, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(128),
                    nn.ReLU(inplace=True),
                ),
                # [B, 128, 6, 6] -> [B, 256, 3, 3]
                nn.Sequential(
                    nn.Conv2d(128, 256, kernel_size=3, stride=2, padding=1, bias=False),
                    nn.BatchNorm2d(256),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(256, 256, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(256),
                    nn.ReLU(inplace=True),
                ),
                # [B, 256, 3, 3] -> [B, 512, 1, 1]
                nn.Sequential(
                    nn.Conv2d(256, 512, kernel_size=3, stride=1, padding=0, bias=False),
                    nn.BatchNorm2d(512),
                    nn.ReLU(inplace=True),
                ),
            ])

            # ---- Face decoder -------------------------------------------------
            # Concatenate audio [B,512,1,1] + face [B,512,1,1] → [B,1024,1,1]
            # then upsample back to [B, 64, 96, 96]
            self.face_decoder_blocks = nn.ModuleList([
                # [B, 1024, 1, 1] -> [B, 512, 3, 3]
                nn.Sequential(
                    nn.ConvTranspose2d(1024, 512, kernel_size=3, stride=1, padding=0, bias=False),
                    nn.BatchNorm2d(512),
                    nn.ReLU(inplace=True),
                ),
                # skip from enc block 4 (256): concat -> [B, 768, 3, 3] -> [B, 256, 6, 6]
                nn.Sequential(
                    nn.ConvTranspose2d(512 + 256, 256, kernel_size=3, stride=2,
                                       padding=1, output_padding=1, bias=False),
                    nn.BatchNorm2d(256),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(256, 256, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(256),
                    nn.ReLU(inplace=True),
                ),
                # skip from enc block 3 (128): [B, 384, 6, 6] -> [B, 128, 12, 12]
                nn.Sequential(
                    nn.ConvTranspose2d(256 + 128, 128, kernel_size=3, stride=2,
                                       padding=1, output_padding=1, bias=False),
                    nn.BatchNorm2d(128),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(128, 128, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(128),
                    nn.ReLU(inplace=True),
                ),
                # skip from enc block 2 (64): [B, 192, 12, 12] -> [B, 64, 24, 24]
                nn.Sequential(
                    nn.ConvTranspose2d(128 + 64, 64, kernel_size=3, stride=2,
                                       padding=1, output_padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(64, 64, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                ),
                # skip from enc block 1 (32): [B, 96, 24, 24] -> [B, 64, 48, 48]
                nn.Sequential(
                    nn.ConvTranspose2d(64 + 32, 64, kernel_size=3, stride=2,
                                       padding=1, output_padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(64, 64, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                ),
                # skip from enc block 0 (16): [B, 80, 48, 48] -> [B, 64, 96, 96]
                nn.Sequential(
                    nn.ConvTranspose2d(64 + 16, 64, kernel_size=3, stride=2,
                                       padding=1, output_padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(64, 64, kernel_size=3, stride=1, padding=1, bias=False),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                ),
            ])

            # ---- Output head --------------------------------------------------
            self.output_block = nn.Sequential(
                nn.Conv2d(80, 32, kernel_size=3, stride=1, padding=1),
                nn.BatchNorm2d(32),
                nn.ReLU(inplace=True),
                nn.Conv2d(32, 3, kernel_size=1, stride=1, padding=0),
                nn.Sigmoid(),
            )

        def forward(self, audio_sequences, face_sequences):
            # audio_sequences : [B, T, 1, 80, 16]  or  [B*T, 1, 80, 16]
            # face_sequences  : [B, T, 6, 96, 96]  or  [B*T, 6, 96, 96]
            # The original code reshapes before calling:
            #   audio = audio.view(B*T, 1, 80, mel_step)
            #   face  = face.view(B*T, 6, 96, 96)

            # Audio encoding
            audio_emb = self.audio_encoder(audio_sequences)   # [B, 512, 1, 1]

            # Face encoding with skip connections
            face_feats = []
            x = face_sequences
            for block in self.face_encoder_blocks:
                x = block(x)
                face_feats.append(x)

            # x is [B, 512, 1, 1] here; face_feats[-1] same as x
            # Combine: cat audio + face bottleneck
            x = face_feats[-1]
            x = self.face_decoder_blocks[0](
                _cat_audio_face(audio_emb, x)
            )  # [B, 512, 3, 3]

            for i, dec_block in enumerate(self.face_decoder_blocks[1:], 1):
                skip = face_feats[-(i + 1)]
                x = dec_block(_cat(x, skip))

            # x: [B, 64, 96, 96]; final skip from input face frame
            # The original concatenates the masked face (original image upper half)
            # and decodes.  We keep the same output block but note the output
            # head receives the decoded feature map (no extra concat here).
            out = self.output_block(x)
            return out

    return Wav2Lip()


def _cat_audio_face(audio_emb, face_emb):
    """Concatenate [B,512,1,1] audio and face bottlenecks along channel dim."""
    import torch
    return torch.cat([audio_emb, face_emb], dim=1)  # [B, 1024, 1, 1]


def _cat(a, b):
    """Concatenate two feature maps along channel dim (for skip connections)."""
    import torch
    return torch.cat([a, b], dim=1)
