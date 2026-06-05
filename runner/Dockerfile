FROM ubuntu:22.04

ARG RUNNER_VERSION=2.321.0
ARG TARGETARCH=x64

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    git \
    sudo \
    unzip \
    wget \
    ca-certificates \
    gnupg \
    # Playwright dependencies
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create runner user
RUN useradd -m -s /bin/bash runner && \
    echo "runner ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Install GitHub Actions runner
WORKDIR /home/runner/actions-runner
RUN curl -o actions-runner.tar.gz -L \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${TARGETARCH}-${RUNNER_VERSION}.tar.gz" \
    && tar xzf actions-runner.tar.gz \
    && rm actions-runner.tar.gz \
    && ./bin/installdependencies.sh \
    && chown -R runner:runner /home/runner

USER runner

# Install Playwright browsers
RUN npx playwright install chromium

COPY entrypoint.sh /home/runner/entrypoint.sh

ENTRYPOINT ["/home/runner/entrypoint.sh"]
