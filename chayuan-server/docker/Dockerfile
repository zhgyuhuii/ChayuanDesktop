# 基础镜像
FROM python:3.11
LABEL maintainer=Langchain-Chatchat
WORKDIR /root

# 环境变量
ENV CHAYUAN_ROOT=/root/chayuan_data

# 初始化环境
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone
RUN apt-get update -y && \
    apt-get install -y git && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN pip install --upgrade pip setuptools
RUN pip install --index-url https://pypi.python.org/simple/ pipx && \
    pipx install poetry --force

# Add poetry to PATH
ENV PATH="/root/.local/bin:${PATH}"

# 下载 Langchain-Chatchat
RUN git clone https://github.com/chatchat-space/Langchain-Chatchat.git

# 安装依赖
WORKDIR /root/Langchain-Chatchat/libs/chayuan-server
RUN poetry config virtualenvs.create false
RUN poetry install --with lint,test -E xinference

## 确保 Python 可以找到 chayuan 等源码包
ENV PYTHONPATH="/root/Langchain-Chatchat/libs/chayuan-server:${PYTHONPATH}"

# 初始化配置
WORKDIR /root/Langchain-Chatchat/libs/chayuan-server
RUN python chayuan/cli.py init

# 初始化知识库文件
ADD data.tar.gz $CHAYUAN_ROOT/

EXPOSE 7861 8501
ENTRYPOINT ["python", "chayuan/cli.py", "start", "-a"]