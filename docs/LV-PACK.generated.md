# PORTAL GLOBAL - LV PACK (generated)

- Generated: **2026-03-06 23:02:06**
- Repo root: C:\Users\user\portal-global

## What this file is
This is the single **canonical pack** to drop into NotebookLM (Notebook: **LV**) so it can answer *strictly based on sources*.
If something is missing, add it to docs/ and regenerate this pack.

## Quick commands
```
cd C:\Users\user\portal-global
pwsh -NoProfile -ExecutionPolicy Bypass -File ops\\lv-pack.ps1
```

## Repo directory tree (dirs only, depth 4)
```
portal-global\
  C:\Users\user\portal-global\.aider.tags.cache.v4\
  C:\Users\user\portal-global\.github\
    C:\Users\user\portal-global\.github\workflows\
  C:\Users\user\portal-global\.venv-aider311\
    C:\Users\user\portal-global\.venv-aider311\Lib\
      C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\__pycache__\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\_distutils_hack\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\_sounddevice_data\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\_soundfile_data\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\_yaml\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aider\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aider_chat-0.86.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aiohappyeyeballs\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aiohappyeyeballs-2.6.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aiohttp\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aiohttp-3.13.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aiosignal\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\aiosignal-1.4.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\annotated_doc\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\annotated_doc-0.0.4.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\annotated_types\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\annotated_types-0.7.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\anyio\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\anyio-4.12.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\asgiref\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\asgiref-3.11.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\attr\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\attrs\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\attrs-25.4.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\backoff\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\backoff-2.2.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\beautifulsoup4-4.14.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\bs4\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\certifi\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\certifi-2026.1.4.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\cffi\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\cffi-2.0.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\charset_normalizer\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\charset_normalizer-3.4.4.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\click\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\click-8.3.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\colorama\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\colorama-0.4.6.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\configargparse-1.7.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\dateutil\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\diff_match_patch\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\diff_match_patch-20241021.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\diskcache\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\diskcache-5.6.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\distro\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\distro-1.9.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\dotenv\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\fastapi\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\fastapi-0.128.8.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\fastuuid\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\fastuuid-0.14.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\filelock\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\filelock-3.20.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\flake8\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\flake8-7.3.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\frozenlist\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\frozenlist-1.8.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\fsspec\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\fsspec-2026.2.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\git\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\gitdb\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\gitdb-4.0.12.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\gitpython-3.1.46.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\grep_ast\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\grep_ast-0.9.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\h11\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\h11-0.16.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\hf_xet\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\hf_xet-1.2.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\httpcore\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\httpcore-1.0.9.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\httpx\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\httpx-0.28.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\huggingface_hub\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\huggingface_hub-1.4.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\idna\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\idna-3.11.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\importlib_metadata\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\importlib_metadata-7.2.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\importlib_resources\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\importlib_resources-6.5.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jinja2\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jinja2-3.1.6.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jiter\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jiter-0.13.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\json5\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\json5-0.13.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jsonschema\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jsonschema_specifications\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jsonschema_specifications-2025.9.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\jsonschema-4.26.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\litellm\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\litellm-1.81.10.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\markdown_it\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\markdown_it_py-4.0.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\markupsafe\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\markupsafe-3.0.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mccabe-0.7.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mdurl\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mdurl-0.1.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mixpanel\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mixpanel-5.0.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mslex\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\mslex-1.3.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\multidict\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\multidict-6.7.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\networkx\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\networkx-3.4.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\numpy\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\numpy-1.26.4.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\numpy.libs\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\openai\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\openai-2.20.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\orjson\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\orjson-3.11.7.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\oslex\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\oslex-0.1.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\packaging\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\packaging-26.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pathspec\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pathspec-1.0.4.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pexpect\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pexpect-4.9.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\PIL\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pillow-12.1.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pip\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pip-26.0.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\posthog\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\posthog-7.8.6.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\prompt_toolkit\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\prompt_toolkit-3.0.52.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\propcache\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\propcache-0.4.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\psutil\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\psutil-7.2.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\ptyprocess\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\ptyprocess-0.7.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pycodestyle-2.14.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pycparser\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pycparser-3.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pydantic\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pydantic_core\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pydantic_core-2.41.5.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pydantic-2.12.5.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pydub\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pydub-0.25.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pyflakes\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pyflakes-3.4.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pygments\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pygments-2.19.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pypandoc\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pypandoc-1.16.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pyperclip\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pyperclip-1.11.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\python_dateutil-2.9.0.post0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\python_dotenv-1.2.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\pyyaml-6.0.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\referencing\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\referencing-0.37.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\regex\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\regex-2026.1.15.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\requests\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\requests-2.32.5.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\rich\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\rich-14.3.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\rpds\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\rpds_py-0.30.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\scipy\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\scipy-1.15.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\scipy.libs\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\setuptools\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\setuptools-82.0.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\shellingham\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\shellingham-1.5.4.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\shtab\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\shtab-1.8.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\six-1.17.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\smmap\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\smmap-5.0.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\sniffio\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\sniffio-1.3.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\socksio\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\socksio-1.0.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\sounddevice-0.5.5.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\soundfile-0.13.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\soupsieve\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\soupsieve-2.8.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\starlette\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\starlette-0.52.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tiktoken\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tiktoken_ext\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tiktoken-0.12.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tokenizers\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tokenizers-0.22.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tqdm\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tqdm-4.67.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_c_sharp\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_c_sharp-0.23.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_c-sharp\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_embedded_template\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_embedded_template-0.25.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_language_pack\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_language_pack-0.13.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_yaml\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter_yaml-0.7.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\tree_sitter-0.25.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\typer\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\typer_slim-0.23.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\typer-0.23.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\typing_extensions-4.15.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\typing_inspection\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\typing_inspection-0.4.2.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\urllib3\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\urllib3-2.6.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\watchfiles\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\watchfiles-1.1.1.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\wcwidth\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\wcwidth-0.6.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\wheel\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\wheel-0.46.3.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\yaml\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\yarl\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\yarl-1.22.0.dist-info\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\zipp\
        C:\Users\user\portal-global\.venv-aider311\Lib\site-packages\zipp-3.23.0.dist-info\
    C:\Users\user\portal-global\.venv-aider311\Scripts\
  C:\Users\user\portal-global\2026-improvements\
  C:\Users\user\portal-global\AGENTS\
  C:\Users\user\portal-global\archive\
  C:\Users\user\portal-global\backend\
    C:\Users\user\portal-global\backend\agent\
    C:\Users\user\portal-global\backend\autopilot\
    C:\Users\user\portal-global\backend\db\
      C:\Users\user\portal-global\backend\db\sql\
    C:\Users\user\portal-global\backend\email\
    C:\Users\user\portal-global\backend\financial\
    C:\Users\user\portal-global\backend\html\
    C:\Users\user\portal-global\backend\intake\
    C:\Users\user\portal-global\backend\lib\
    C:\Users\user\portal-global\backend\local-runner\
    C:\Users\user\portal-global\backend\metrics\
    C:\Users\user\portal-global\backend\middleware\
    C:\Users\user\portal-global\backend\modules\
    C:\Users\user\portal-global\backend\pages\
    C:\Users\user\portal-global\backend\public\
      C:\Users\user\portal-global\backend\public\css\
      C:\Users\user\portal-global\backend\public\icons\
      C:\Users\user\portal-global\backend\public\js\
    C:\Users\user\portal-global\backend\routes\
    C:\Users\user\portal-global\backend\scripts\
    C:\Users\user\portal-global\backend\src\
      C:\Users\user\portal-global\backend\src\middleware\
      C:\Users\user\portal-global\backend\src\utils\
    C:\Users\user\portal-global\backend\utils\
    C:\Users\user\portal-global\backend\workers\
  C:\Users\user\portal-global\data\
    C:\Users\user\portal-global\data\autopilot\
  C:\Users\user\portal-global\database\
  C:\Users\user\portal-global\db\
    C:\Users\user\portal-global\db\migrations\
  C:\Users\user\portal-global\deploy\
  C:\Users\user\portal-global\docs\
    C:\Users\user\portal-global\docs\ga-test\
      C:\Users\user\portal-global\docs\ga-test\backup\
        C:\Users\user\portal-global\docs\ga-test\backup\docs\
      C:\Users\user\portal-global\docs\ga-test\baseline\
        C:\Users\user\portal-global\docs\ga-test\baseline\docs\
      C:\Users\user\portal-global\docs\ga-test\variant-a\
        C:\Users\user\portal-global\docs\ga-test\variant-a\docs\
      C:\Users\user\portal-global\docs\ga-test\variant-b\
        C:\Users\user\portal-global\docs\ga-test\variant-b\docs\
      C:\Users\user\portal-global\docs\ga-test\variant-c\
        C:\Users\user\portal-global\docs\ga-test\variant-c\docs\
      C:\Users\user\portal-global\docs\ga-test\variant-d\
        C:\Users\user\portal-global\docs\ga-test\variant-d\docs\
      C:\Users\user\portal-global\docs\ga-test\variant-e\
        C:\Users\user\portal-global\docs\ga-test\variant-e\docs\
    C:\Users\user\portal-global\docs\proxy-examples\
  C:\Users\user\portal-global\frontend\
    C:\Users\user\portal-global\frontend\src\
      C:\Users\user\portal-global\frontend\src\contexts\
      C:\Users\user\portal-global\frontend\src\hooks\
      C:\Users\user\portal-global\frontend\src\lib\
      C:\Users\user\portal-global\frontend\src\pages\
  C:\Users\user\portal-global\logs\
    C:\Users\user\portal-global\logs\archive\
    C:\Users\user\portal-global\logs\audit-clean\
  C:\Users\user\portal-global\middleware\
  C:\Users\user\portal-global\ops\
    C:\Users\user\portal-global\ops\agent\
    C:\Users\user\portal-global\ops\bin\
    C:\Users\user\portal-global\ops\ga\
      C:\Users\user\portal-global\ops\ga\backup\
    C:\Users\user\portal-global\ops\snapshots\
    C:\Users\user\portal-global\ops\tmp\
  C:\Users\user\portal-global\routes\
  C:\Users\user\portal-global\scripts\
  C:\Users\user\portal-global\services\
    C:\Users\user\portal-global\services\crew-runner\
      C:\Users\user\portal-global\services\crew-runner\__pycache__\
  C:\Users\user\portal-global\src\
    C:\Users\user\portal-global\src\utils\
  C:\Users\user\portal-global\static\
    C:\Users\user\portal-global\static\css\
    C:\Users\user\portal-global\static\icons\
    C:\Users\user\portal-global\static\js\
  C:\Users\user\portal-global\test\
  C:\Users\user\portal-global\web-next\
    C:\Users\user\portal-global\web-next\app\
      C:\Users\user\portal-global\web-next\app\(portal)\
        C:\Users\user\portal-global\web-next\app\(portal)\orders\
      C:\Users\user\portal-global\web-next\app\admin\
      C:\Users\user\portal-global\web-next\app\api\
        C:\Users\user\portal-global\web-next\app\api\auth\
        C:\Users\user\portal-global\web-next\app\api\ports\
        C:\Users\user\portal-global\web-next\app\api\upload\
      C:\Users\user\portal-global\web-next\app\app\
      C:\Users\user\portal-global\web-next\app\components\
      C:\Users\user\portal-global\web-next\app\lib\
      C:\Users\user\portal-global\web-next\app\login\
      C:\Users\user\portal-global\web-next\app\register\
    C:\Users\user\portal-global\web-next\components\
    C:\Users\user\portal-global\web-next\pages\
      C:\Users\user\portal-global\web-next\pages\admin__legacy\
        C:\Users\user\portal-global\web-next\pages\admin__legacy\tenants\
    C:\Users\user\portal-global\web-next\public\
      C:\Users\user\portal-global\web-next\public\uploads\
```

## Live node listeners (best effort)
```
  3000  0.0.0.0          pid:41408
  3001  ::               pid:54600
```

## package.json (truncated)
```json
{
    "name": "portal-global",
    "version": "1.0.0",
    "description": "Unified Portal Management Platform",
    "main": "server.js",
    "scripts": {
        "state": "pwsh -NoProfile -ExecutionPolicy Bypass -File ops/generate-current-state.ps1",
        "start": "node server.js",
        "worker": "node backend/workers/email-worker.js",
        "daily-report": "node scripts/daily-report.js",
        "test:financial-event": "node scripts/test-financial-event.js",
        "db:email": "node backend/scripts/apply-email-sql.js",
        "test": "echo \"Tests not configured\" && exit 0",
        "lint": "eslint . --ext .js",
        "lint:fix": "eslint . --ext .js --fix",
        "fix:encoding": "node backend/fix-encoding.js",
        "extract:ui": "node backend/extract-ui.js",
        "build:map": "node backend/build-ui-map.js",
        "dev:backend": "cmd /V:ON /C \"if not defined BACKEND_PORT set BACKEND_PORT=3000 && set PORT=!BACKEND_PORT! && nodemon server.js\"",
        "dev:frontend": "cmd /V:ON /C \"if not defined WEB_PORT set WEB_PORT=3001 && if not defined BACKEND_PORT set BACKEND_PORT=3000 && if not defined NEXT_PUBLIC_API_BASE_URL set NEXT_PUBLIC_API_BASE_URL=http://localhost:!BACKEND_PORT! && cd web-next && npm run dev -- --port !WEB_PORT!\"",
        "dev:web": "cmd /V:ON /C \"if not defined WEB_PORT set WEB_PORT=3001 && if not defined BACKEND_PORT set BACKEND_PORT=3000 && if not defined NEXT_PUBLIC_API_BASE_URL set NEXT_PUBLIC_API_BASE_URL=http://localhost:!BACKEND_PORT! && cd web-next && npm run dev -- --port !WEB_PORT!\"",
        "dev:legacy": "cd backend && npm run dev",
        "build": "node -e \"console.log('No build step required.')\"",
        "build:backend": "node -e \"console.log('No backend build step required.')\"",
        "build:frontend": "node -e \"console.log('No frontend build step required.')\"",
        "start:backend": "node server.js",
        "start:web": "node -e \"console.log('No separate web start; use npm start.')\"",
        "db:migrate": "cd backend && npm run db:migrate",
        "db:seed": "cd backend && npm run db:seed",
        "db:reset": "cd backend && npm run db:reset",
        "pipes:init": "node pipes/scripts/init_pipes.js",
        "pipes:json": "node pipes/scripts/import_csv_to_json.js",
        "pipes:totals": "node pipes/scripts/calc_totals.js",
        "pipes:listings": "node pipes/scripts/generate_listings.js",
        "pipes:all": "npm run pipes:init && npm run pipes:json && npm run pipes:totals && npm run pipes:listings",
        "dev": "concurrently \"npm run dev:backend\" \"npm run dev:web\"",
        "start:prod": "node server.js",
        "health": "node ops/healthcheck.js",
        "ports": "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/scan-ports.ps1",
        "smoke": "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke.ps1",
        "chat": "node -e \"fetch(\\\"http://localhost:3000/api/chat\\\",{method:\\\"POST\\\",headers:{\\\"Content-Type\\\":\\\"application/json\\\"},body:JSON.stringify({message:\\\"Hello\\\"})}).then(r=>r.text()).then(console.log).catch(e=>{console.error(e);process.exit(1)})\""
    },
    "dependencies": {
        "@sendgrid/mail": "^7.7.0",
        "bcrypt": "^5.1.1",
        "compression": "^1.7.4",
        "cookie-parser": "^1.4.7",
        "cors": "^2.8.5",
        "dotenv": "^16.3.1",
        "express": "^4.18.2",
        "express-rate-limit": "^6.7.0",
        "express-validator": "^7.0.1",
        "helmet": "^7.0.0",
        "iconv-lite": "^0.6.3",
        "jsdom": "^22.1.0",
        "jsonwebtoken": "^9.0.3",
        "morgan": "^1.10.0",
        "multer": "^1.4.5-lts.1",
        "nodemailer": "^8.0.1",
        "socket.io": "^4.7.0",
        "sqlite3": "^5.1.7",
        "validator": "^13.9.0"
    },
    "devDependencies": {
        "concurrently": "^9.2.1",
        "eslint": "^8.47.0",
        "nodemon": "^3.1.11",
        "prettier": "^3.0.2"
    },
    "keywords": [
        "portal",
        "management",
        "dashboard",
        "projects",
        "ai",
        "express",
        "nodejs"
    ],
    "author": "PORTAL GLOBAL Team",
    "license": "MIT",
    "engines": {
        "node": ">=18.0.0"
    }
}

```

## .env.example (truncated)
```
# ============================================================
# PORTAL GLOBAL - COMMUNITY MODE CONFIG
# Safe defaults for public exposure
# Copy to .env and fill secrets
# ============================================================

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# ============================================================
# COMMUNITY MODE (SECURE BY DEFAULT)
# ============================================================
COMMUNITY_MODE=1
AUTOPILOT_ENABLED=0
EXTERNAL_LLM_ENABLED=0

# ============================================================
# RATE LIMITING
# ============================================================
RATE_LIMIT_ENABLED=1
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_PUBLIC=120
RATE_LIMIT_MAX_AUTH=300
RATE_LIMIT_MAX_HEALTH=600
AUTH_ME_RATE_LIMIT_MAX=30
LOGIN_RATE_LIMIT_MAX=10
FEEDBACK_RATE_LIMIT_MAX=5

# ============================================================
# SECURITY
# ============================================================
TRUST_PROXY=1
FORCE_HTTPS=1
HIDE_STACKTRACES=1

# Body size limits (keep small for public API)
BODY_SIZE_LIMIT=200kb

# ============================================================
# AUTH CACHE
# ============================================================
AUTH_CACHE_TTL_MS=120000
AUTH_ME_TTL_MS=120000
AUTH_CACHE_MAX_SIZE=100

# ============================================================
# CORS (set to your domain in production)
# ============================================================
DEMO_ORIGIN=https://your-domain.onrender.com
ALLOWED_ORIGINS=https://your-domain.onrender.com

# ============================================================
# SOCKET.IO LIMITS
# ============================================================
SOCKET_MAX_CONNECTIONS_PER_IP=5
SOCKET_PING_TIMEOUT=20000
SOCKET_PING_INTERVAL=25000

# ============================================================
# AI / AUTOPILOT
# ============================================================
AI_CALL_TIMEOUT_MS=30000
POLLING_INTERVAL_MS=30000

# ============================================================
# LOGGING
# ============================================================
LOG_LEVEL=info

# ============================================================
# DATABASE
# ============================================================
DATABASE_PATH=./database/portal.db

# ============================================================
# SESSION
# ============================================================
SESSION_COOKIE_NAME=portal_session
SESSION_TTL_DAYS=7

# ============================================================
# SUPPORT / HELP
# ============================================================
SUPPORT_EMAIL=portal.global.project@gmail.com
VIDEO_GUIDE_URL=

# ============================================================
# DEV/PROD OVERRIDES
# ============================================================
# For local dev, uncomment:
# NODE_ENV=development
# DEMO_ORIGIN=http://localhost:3000

```

## README (truncated)
```md
# Short summary
- Quick start: npm install, npm run dev, open /orders.
- Lists agent conversation endpoints and workflows.
- Documents revenue tracking tables and email worker config.
- Describes file upload UI/UX and supported file types.
# PORTAL - File Upload Feature

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

3. **Navigate to:** http://localhost:3000/(portal)/orders

## Agent Conversation System
- Deterministic, tenant-scoped agent pipeline (EventNormalizer, Router, UICoach, Leads, Revenue)
- UI: open `/app` and click **Agent Console** to view messages and draft actions
- API: `POST /api/agent/events`, `POST /api/agent/dispatch`, `GET /api/agent/messages`, `GET /api/agent/actions`, `POST /api/agent/actions/execute`

## Deploy on Render

See `DEPLOY-RENDER.md` for the canonical commands, schedules, and env vars. The worker entrypoint is `npm run worker`, the cron entrypoint is `npm run daily-report`, and the test entrypoint is `npm run test:financial-event`.

## 💸 Revenue Tracking & Email Reports

### Database tables (auto-created)
- `financial_events`: `tenant_id`, `user_id`, `type`, `amount`, `currency`, `tags`, `source`, `created_at`
- `email_outbox`: `to`, `subject`, `html`, `text`, `status`, `attempts`, `last_error`, `last_attempt_at`, `created_at`

### API
**POST** `/api/events/financial` (auth required, tenant-aware)

Body example:
```json
{
  "type": "payment_received",
  "amount": 149.99,
  "currency": "EUR",
  "tags": ["subscription", "pro"],
  "source": "stripe"
}
```

### Email worker
- Worker: `npm run worker`
- Daily report: `npm run daily-report`
- Test event: `npm run test:financial-event`
- `ops/run-dev.ps1` starts the worker alongside the API

### Email configuration
- **SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`
- **SendGrid**: `SENDGRID_API_KEY` + `EMAIL_FROM` (or `SENDGRID_FROM`)
- **Owner alert**: `OWNER_EMAIL` receives immediate `payment_received` notifications
- **Default currency**: `DEFAULT_CURRENCY` (fallback when `currency` is omitted, default `EUR`)
- **Daily report timezone**: Europe/Berlin
- **Worker tuning**: `EMAIL_MAX_ATTEMPTS`, `EMAIL_BATCH_SIZE`, `EMAIL_POLL_INTERVAL_MS`, `EMAIL_STUCK_MINUTES`

## 📁 File Upload Features

### Supported File Types
- PDF documents (✅)
- Microsoft Word (.doc, .docx) (✅)
- Microsoft Excel (.xls, .xlsx) (✅)
- Other common document formats

### File Size Limits
- Maximum file size: 100MB per file
- No limit on number of files

### Upload Methods
1. **Drag & Drop** - Simply drag files onto the upload area
2. **Browse Files** - Click to select files from your computer

## 🎨 User Interface

### Main Upload Area
- Modern dark theme design
- Visual feedback when dragging files
- Real-time progress tracking
- Error handling with clear messages

### Progress Tracking
- Individual progress bars for each file
- Status indicators (pending, uploading, success, error)
- Estimated upload time
- Pause/resume functionality

### File Management
- Remove files before upload
- View file details (name, size, type)
- Retry failed uploads
- Cancel ongoing uploads

## 🔧 Technical Implementation

### Frontend
- **React 18** with TypeScript
- **Next.js 14** App Router
- **Tailwind CSS** for styling
- **Lucide React** for icons

### Backend
- **Node.js** with Express
- **Multer** for file handling
- **File System** storage
- **Next.js API Routes**

### File Storage
- Local storage in `/public/uploads`
- Automatic unique filename generation
- File metadata tracking

## 📝 Usage Instructions

### Creating an Order
1. Navigate to **Orders** page
2. Fill in order details
3. Attach files (optional)
4. Click "Create order"
5. Wait for files to upload
6. Order is created with uploaded files

### Uploading Files
1. Click "Attach files" button
2. Select files from your computer
3. Or drag files directly onto the upload area
4. Monitor progress in real-time
5. Remove files if needed before submission

### File Validation
- Automatic file type checking
- Size limit validation
- Error messages for invalid files
- Progress tracking for valid files

## 🔍 File Types Reference

### Document Formats
- **PDF**: `.pdf`
- **Word**: `.doc`, `.docx`
- **Excel**: `.xls`, `.xlsx`
- **Text**: `.txt`, `.rtf`
- **OpenOffice**: `.odt`, `.ods`

### Image Formats (if enabled)
- **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`

## 🐛 Troubleshooting

### Common Issues

#### Files not uploading
- Check file size (max 100MB)
- Verify file type is supported
- Ensure internet connection
- Check browser console for errors

#### Progress not showing
- Wait a few seconds for upload to start
- Check browser network tab
- Verify server is running

#### Error messages
- "File size exceeds limit" - Reduce file size
- "Invalid file type" - Use supported formats
- "Network error" - Check internet connection

### Debug Mode
Enable debug mode in development:
```bash
DEBUG=portal:* npm run dev
```

## 🔒 Security Features

### File Validation
- MIME type checking
- File extension validation
- Size limits
- Virus scanning (future enhancement)

### Access Control
- Authentication required
- File ownership tracking
- Access logging
- Secure file paths

## 📊 Performance

### Upload Speed
- Optimized for large files
- Concurrent uploads supported
- Progress tracking with accurate estimates
- Resume capability for interrupted uploads

### Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 🔄 Future Enhancements

### Planned Features
- Cloud storage integration (AWS S3, Google Cloud)
- File preview functionality
- Batch processing
- Compression for large files
- Virus scanning
- File versioning

### API Extensions
- File metadata API
- Bulk upload operations
- File transformation
- Webhook notifications

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

### Development Setup
```bash
# Clone the repository
git clone https://github.com/your-repo/portal.git
cd portal

# Install dependencies
npm install

# Start development servers
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- React Team for the amazing framework
- Next.js for the excellent platform
- Tailwind CSS for the utility-first approach
- All contributors and supporters

---

**Last Updated:** February 2026
**Version:** 1.0.0

Topics: quickstart, agent, revenue, email, uploads
People: none
Decision type: reference
Status: active

```

## docs/PROJECT-STATE.md (truncated)
```md
# Short summary
- Project summary: monorepo with Express backend and web-next UI.
- Canonical state: PROJECT-STATE + AGENTS; CURRENT-STATE missing.
- Mission status with last pass and next action.
- Pointers to dev, architecture, autopilot, and risks.
# PROJECT-STATE

## A) Summary
PORTAL Global is a monorepo with a primary Node.js/Express backend (`server.js`) and SQLite persistence. The primary UI is `web-next` (Next.js) with session-token auth (cookie + optional Bearer). The legacy static UI under `backend/pages` remains available but is not the default. The `frontend/` app is deprecated.

## A0) Canonical inventory / current state
> NOTE (TODO): `docs/CURRENT-STATE.generated.md` is currently missing in the repo.
> - If the project expects it to be generated, document the generator command here (e.g. `npm run state` or `pwsh ...`).
> - Until it exists, treat `docs/PROJECT-STATE.md` + `AGENTS.md` as the canonical overview.

## A0.1) Environment notes (rate limits)
> NOTE: `.env` and `.env.example` currently use different rate limit variable names.
> - Example observed: `.env` has `RATE_LIMIT_MAX`, while `.env.example` uses more specific keys (e.g. per-route/public/auth/health).
> - Action: reconcile naming (pick one scheme) and document which variables are actually read by the server code.

## A1) Mission status
- Mission: 3-10 (multi-tenant RBAC/admin, tenant switcher, admin smoke + tenant scenarios, night-shift automation)
- Last PASS (health + smoke): 2026-02-25T00:12:56.2272519+01:00
- Git commit: none
- Next action: continue Mission 3-10 follow-ups after tenant smoke PASS

## Night Shift
<!-- NIGHT-SHIFT-START -->
- Last run: 2026-02-25T01:33:31.5507430+01:00
- Mission: 3
- Item: m3-tenant-switch-ui
- Status: PASS
- Exit code: 0
- Log: C:\Users\user\portal-global\logs\night-shift.json
<!-- NIGHT-SHIFT-END -->

## B) Repository structure (key paths)
```text
portal-global/
  server.js
  package.json
  .env.example
  .env.production.example
  web-next/           (primary UI)
  backend/pages/      (legacy UI)
  frontend/           (deprecated)
  docs/
  ops/
  scripts/
```

## C) Local dev (Windows PowerShell)
- Zero-hands loop: `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\autopilot-loop.ps1`
- Start dev: `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\run-dev.ps1`
- What runs: `npm run dev` = backend + web-next.
- Ports:
  - Default: `BACKEND_PORT=3000`, `WEB_PORT=3001`.
  - If either is busy, `ops/run-dev.ps1` auto-falls back to `3100/3101` and prints the chosen ports.
- Health: `npm run health` or `curl.exe http://localhost:<BACKEND_PORT>/api/health`.

## D) Architecture (current)
- Backend: `server.js` (Express + SQLite). Tenant-scoped data and session-token auth.
- Auth: session token stored in `sessions`; cookie name `SESSION_COOKIE_NAME` (default `portal_session`). Optional Bearer token is accepted.
- UI (primary): `web-next` uses a unified API client with `credentials: include` and optional Bearer token from login response.
- UI (legacy): `backend/pages/*` remains reachable on backend port.

## E) Autopilot
- Endpoints: `POST /api/autopilot/enable`, `GET /api/autopilot/status`, `POST /api/autopilot/tick`, plus offers/leads/metrics.
- Enable/tick require tenant admin (session) or service-token fallback.
- Fallback auth (no session): only for `enable` + `tick` using service token + tenant headers.
- Docs: `docs/AUTOPILOT.md`.

## F) UI and navigation
- Primary UI (web-next):
  - Register: `http://localhost:<WEB_PORT>/register`
  - Login: `http://localhost:<WEB_PORT>/login`
  - App: `http://localhost:<WEB_PORT>/app`
- Legacy UI (backend pages): `http://localhost:<BACKEND_PORT>/login`
- `frontend/` is deprecated and excluded from dev scripts.

## G) Ops scripts
- `ops/run-dev.ps1`: auto-selects ports, sets env for backend + web-next, installs deps, runs `npm run dev`.
- `ops/autopilot-loop.ps1`: zero-hands loop (start dev, detect ports, run smoke, auto-retry, log results).
- `scripts/smoke.ps1`: health check + auth + autopilot status/enable/tick with fallback.
- `ops/kill-port.ps1`: optional manual cleanup, not required for dev.

## H) Env highlights
- Core: `PORT`, `HOST`, `DATABASE_PATH`, `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`, `ALLOWED_ORIGINS`.
- Dev ports: `BACKEND_PORT`, `WEB_PORT` (used by scripts; auto-set by `ops/run-dev.ps1`).
- Admin bootstrap (dev): `ADMIN_BOOTSTRAP_CODE` (legacy: `ADMIN_BOOTSTRAP_TOKEN`).

## I) Checks
```powershell
curl.exe http://localhost:<BACKEND_PORT>/api/health

curl.exe -X POST "http://localhost:<BACKEND_PORT>/api/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"demo@local\",\"password\":\"demo12345\"}" `
  -c .cookies.txt

curl.exe "http://localhost:<BACKEND_PORT>/api/autopilot/status" -b .cookies.txt
```

## J) Risks / notes
- Multiple UI surfaces exist; web-next is the single source of truth for new work.
- `frontend/` is deprecated due to mismatched API endpoints and missing imports.

Topics: project-state, mission, dev, architecture, autopilot
People: none
Decision type: status
Status: active

```

## docs/CURRENT-STATE.generated.md (truncated)
_Missing docs/CURRENT-STATE.generated.md (TODO: generate it)._ 

## Approx extracted routes: server.js
```
No obvious route patterns found in C:\Users\user\portal-global\server.js (or file is too different).
```

## Approx extracted routes: backend/autopilot/routes.js
```
POST /enable    router.post('/enable', checkAutopilotEnabled, requireAdmin, async (req, res) => {
GET /status    router.get('/status', async (req, res) => {
POST /tick    router.post('/tick', checkAutopilotEnabled, requireAdmin, requireAutopilotLimit, async (req, res) => {
GET /offers    router.get('/offers', async (req, res) => {
POST /offers    router.post('/offers', async (req, res) => {
GET /leads    router.get('/leads', async (req, res) => {
POST /leads/capture    router.post('/leads/capture', async (req, res) => {
GET /metrics    router.get('/metrics', async (req, res) => {
```

## Known issues (TODO list for NotebookLM + OpenCode)
- [ ] Too Many Requests on /api/auth/me (request storm / rate limit) - document root cause + fix.
- [ ] Tenant Unknown / session missing / role guest / auth cookie+b bearer - document expected auth flow.
- [ ] Health Offline/Not Found / Ports detected - document what health means per service.

## Community mode (safe defaults)
- Default **read-only** for anonymous users (no writes, no autopilot).
- Rate limit: per-IP, protect /api/auth/* and any expensive endpoints.
- Require auth + role for admin panels and autopilot actions.
- Add basic observability: request IDs + audit log for auth + errors.


