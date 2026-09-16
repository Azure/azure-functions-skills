import asyncio


async def count_events():
    for count in range(5):
        yield f"data: {count}\n\n"
        await asyncio.sleep(0)
