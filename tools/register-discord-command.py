#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

APPLICATION_ID = '1504349714282188892'
GUILD_ID = '859864250919157811'
ENV_KEY = 'Discord_Bot_Token_OH'


def load_env_value(key: str) -> str:
    if os.getenv(key):
        return os.environ[key]
    env_path = Path.home() / '.hermes' / '.env'
    for line in env_path.read_text(encoding='utf-8').splitlines():
        if not line or line.lstrip().startswith('#') or '=' not in line:
            continue
        name, value = line.split('=', 1)
        if name == key:
            return value.strip().strip('"').strip("'")
    raise RuntimeError(f'Missing {key}')


def discord_request(method: str, path: str, body=None):
    token = load_env_value(ENV_KEY)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    request = urllib.request.Request(
        f'https://discord.com/api/v10{path}',
        data=data,
        method=method,
        headers={
            'Authorization': f'Bot {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'OnceHumanBuildPlanner/1.0'
        }
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode('utf-8')
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', 'replace')
        raise RuntimeError(f'Discord API HTTP {error.code}: {body}') from None


command = {
    'name': 'searchbuild',
    'description': 'Search Once Human builds by gun and HP type',
    'dm_permission': False,
    'options': [
        {
            'type': 3,
            'name': 'gun',
            'description': 'Full or partial gun name',
            'required': True,
            'min_length': 2,
            'max_length': 80
        },
        {
            'type': 3,
            'name': 'hp',
            'description': 'Build HP selection',
            'required': True,
            'choices': [
                {'name': 'High HP', 'value': 'High HP'},
                {'name': 'Low HP', 'value': 'Low HP'}
            ]
        }
    ]
}

if __name__ == '__main__':
    status, payload = discord_request(
        'POST',
        f'/applications/{APPLICATION_ID}/guilds/{GUILD_ID}/commands',
        command
    )
    print(json.dumps({
        'status': status,
        'id': payload.get('id'),
        'name': payload.get('name'),
        'guild_id': GUILD_ID,
        'options': [option['name'] for option in payload.get('options', [])]
    }, indent=2))
